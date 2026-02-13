'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as tasks from './tasks';
import * as fs from 'fs';
import { showDefinitions, fuzzyDefinitionSearch } from './search';
import { AlanSymbolProvider } from './symbols'
import { manageLanguageServers, restartAllLanguageServers } from './lsp'

import {
	CloseAction,
	ErrorAction,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
	State,
	CompletionItemKind,
	CompletionItem,
	InsertTextFormat,
	Disposable
} from 'vscode-languageclient/node';
import { url } from 'inspector';

interface Snippet {
	prefix: string,
	body: string[],
	description: string
}
interface Snippets {
	[key: string]: Snippet
}

import snippets_model_application from './snippets/model.application.json';
import snippets_interface_interface from './snippets/interface.interface.json';

function parseSnippets(snippets: Snippets): vscode.CompletionItem[] {
	return Object.keys(snippets).map(label => {
		const s = snippets[label];
		return {
			"label": label,
			"filterText": s.prefix,
			"sortText": s.prefix,
			"insertText": new vscode.SnippetString(s.body.join("\n")),
			"kind": vscode.CompletionItemKind.Snippet,
			"documentation": s.description
		}
	});
}
const snippets = new Map<string, vscode.CompletionItem[]>(
	[
		["application.alan", parseSnippets(snippets_model_application)],
		["interface.alan", parseSnippets(snippets_interface_interface)]
	]
);

enum LSPContextType {
	alan = 'alan',
	fabric = 'fabric'
};

interface ProjectDetails {
	uri: vscode.Uri;
	workspace: vscode.WorkspaceFolder;
	subscriptions: Disposable[]
};

const clients = new Map<string, LanguageClient>();

function isAlanDeploySupported(): boolean {
	if (process.env.ALAN_CONTAINER_NAME) {
		return true;
	} else {
		return false;
	}
}

function isAlanAppURLProvided(): boolean {
	if (process.env.ALAN_APP_URL) {
		return true;
	} else {
		return false;
	}
}

function pathIsFSPath(inode_path: string): boolean {
	return inode_path.indexOf(path.sep) !== -1;
}

function resolveContextFile(context): string | undefined {
	if (context && context.fsPath && pathIsFSPath(context.fsPath))
		return context.fsPath

	if (vscode.window.activeTextEditor && pathIsFSPath(vscode.window.activeTextEditor.document.uri.fsPath))
		return vscode.window.activeTextEditor.document.uri.fsPath;

	return undefined;
}

async function resolveContext(context, root_marker: string) {
	const active_file = resolveContextFile(context);
	if (active_file) {
		const active_file_dirname = path.dirname(active_file);
		return {
			context: active_file_dirname,
			root: tasks.resolveRoot(active_file_dirname, root_marker)
		};
	} else if (vscode.workspace.workspaceFolders) {
		const workspace_path = vscode.workspace.workspaceFolders[0].uri.fsPath; //Hmmm..
		const alan_root = tasks.resolveRoot(workspace_path, root_marker);
		return {
			context: alan_root,
			root: alan_root
		};
	}
}
async function resolveContextRoot(context, root_marker: string): Promise<string> {
	const active_file = resolveContextFile(context);
	if (active_file) {
		const active_file_dirname = path.dirname(active_file);
		return tasks.resolveRoot(active_file_dirname, root_marker);
	} else if (vscode.workspace.workspaceFolders.length === 1) {
		const workspace_path = vscode.workspace.workspaceFolders[0].uri.fsPath; //Hmmm..
		return tasks.resolveRoot(workspace_path, root_marker);
	}
}

function getDocumentFilterForPath(path: vscode.Uri) {
	return {
		language: 'alan',
		pattern: `${path.fsPath}/**/*`
	};
}

async function startLanguageServer(context: vscode.ExtensionContext, project: ProjectDetails, language_server: string) {
	const serverOptions: ServerOptions = {
		command: language_server,
		args: ['--lsp'],
		transport: TransportKind.stdio,
		options: {
			cwd: project.uri.fsPath,
		}
	};

	const capture: string = vscode.workspace.getConfiguration('alan-definitions').get<string>('alan-capture');
	if (capture && capture !== null && capture !== '') {
		serverOptions.args.push("--capture", capture);
	}

	const name: string = `Alan LS ${path.relative(project.workspace.uri.fsPath, project.uri.fsPath)}`;
	const clientOptions: LanguageClientOptions = {
		documentSelector: [getDocumentFilterForPath(project.uri)],
		errorHandler: {
			error: (error, message, count) => {
				return {
					action: ErrorAction.Continue
				};
			},
			closed: () => {
				return {
					action: CloseAction.DoNotRestart
				};
			}
		},
		progressOnInitialization: true,
		markdown: {
			isTrusted: true,
			supportHtml: true
		},
		workspaceFolder: {
			uri: project.uri,
			name: `${path.relative(project.workspace.uri.fsPath, project.uri.fsPath)}`,
			index: project.workspace.index
		},
		diagnosticCollectionName: name,
		outputChannelName: name,
		initializationFailedHandler: (error) => {
			vscode.window.showErrorMessage(`Failed to start Alan Language Server for ${project.uri.fsPath}: ${error}`);
			useLegacyImpl(context, project);
			return false;
		}
	};

	const client = new LanguageClient(name, serverOptions, clientOptions);
	clients.set(project.uri.fsPath, client);
	await client.start();
	return client.state != State.Stopped;
}

async function startTool(context: vscode.ExtensionContext, conf: string, project: ProjectDetails) {
	let tool_conf: string = vscode.workspace.getConfiguration('alan-definitions').get(conf);
	if (process.platform === 'win32')
		tool_conf += `.exe`;

	const tool: string = path.resolve(project.uri.fsPath, tool_conf);

	fs.accessSync(tool, fs.constants.X_OK);
	await startLanguageServer(context, project, tool);
}

async function useLegacyImpl(context: vscode.ExtensionContext, project: ProjectDetails) {
	if (vscode.workspace.getConfiguration('alan-definitions').get<boolean>('integrateWithGoToDefinition')) {
		project.subscriptions.push(vscode.languages.registerDefinitionProvider(getDocumentFilterForPath(project.uri), {
			provideDefinition: fuzzyDefinitionSearch
		}));
	}
	project.subscriptions.push(
		vscode.commands.registerTextEditorCommand('alan.editor.showDefinitions', showDefinitions),
		vscode.languages.registerDocumentSymbolProvider(getDocumentFilterForPath(project.uri), new AlanSymbolProvider()));

	context.subscriptions.push(...project.subscriptions);
}

function identifierCompletionItemProvider() {
	return vscode.languages.registerCompletionItemProvider({
		language: 'alan'
	}, {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
			const wrange = document.getWordRangeAtPosition(position, /(?:(?<=^(?:[^']*'[^']*')*[^']*))'[^'\\r\\n]*'/);
			if (!wrange)
				return undefined; //fall back to built-in wordenize; OPT: combine results below with wordenize results

			let result = new Set<string>;
			const re = /'[^']*'(?=:|\s*->|\s*~>)/g;
			for (let i = 0; i < document.lineCount; ++i) {
				const line = document.lineAt(i).text;
				let match;
				while ((match = re.exec(line)) !== null) {
					result.add(match[0]);
				}
				re.lastIndex = 0; // reset for next line
			}

			return Array.from(result.values()).map(id => {
				return {
					"label": id,
					"filterText": id,
					"sortText": `~${id}`, /* push to end of list; language server suggestions should come first */
					"insertText": id,
					"kind": vscode.CompletionItemKind.Text,
				}
			})
		}
	}, '.', `'`);
}

export function deactivate(): Thenable<void> | undefined {
	vscode.commands.executeCommand('setContext', 'alan.isAlanDeploySupported', false);
	vscode.commands.executeCommand('setContext', 'alan.isAlanAppURLProvided', false);

	const promises: Thenable<void>[] = [];
	for (const client of clients.values()) {
		promises.push(client.dispose());
	}
	return Promise.all(promises).then(() => undefined);
}

async function provideLanguageSupport(context, type: LSPContextType, project: ProjectDetails) {
	/* If earlier we could not start the language server tool,
	** we are using the legacy implementation.
	** dispose of the existing subscriptions. */
	for (const sub of project.subscriptions) {
		sub.dispose();
	}

	try {
		await startTool(context, type, project);
	} catch (e) {
		useLegacyImpl(context, project);
	}
}

export async function activate(context: vscode.ExtensionContext) {
	const diagnostic_collection = vscode.languages.createDiagnosticCollection();
	const output_channel = vscode.window.createOutputChannel('Alan');

	const auto_bootstrap: boolean = vscode.workspace.getConfiguration('alan-definitions').get('alan-auto-bootstrap');
	const auto_fetch: boolean = vscode.workspace.getConfiguration('alan-definitions').get('fabric-auto-fetch');


	let projects: {
		project_json: { [key: string]: ProjectDetails } /* project.json contexts */
		build_alan: { [key: string]: ProjectDetails } /* build.alan contexts */
		versions_json: { [key: string]: ProjectDetails } /* versions.json contexts */
	} = {
		project_json: {},
		build_alan: {},
		versions_json: {}
	};

	for (const workspace of vscode.workspace.workspaceFolders) {
		let walk = (dir: string) => fs.readdirSync(dir).forEach(fname => {
			const inode = path.resolve(dir, fname);
			const stat = fs.statSync(inode);
			if (stat && stat.isDirectory()) {
				walk(inode);
			} else {
				if (fname === "project.json") {
					projects.project_json[dir] = {
						uri: vscode.Uri.file(dir),
						workspace: workspace,
						subscriptions: []
					};
				}
				else if (fname === "build.alan") {
					projects.build_alan[dir] = {
						uri: vscode.Uri.file(dir),
						workspace: workspace,
						subscriptions: []
					};
				}
				else if (fname === "versions.json") {
					projects.versions_json[dir] = {
						uri: vscode.Uri.file(dir),
						workspace: workspace,
						subscriptions: []
					};
				}
			}
		});
		walk(workspace.uri.fsPath);
	}

	for (const [key, proj] of Object.entries(projects.project_json)) {
		try {
			const path_deps = path.join(proj.uri.fsPath, "dependencies");
			if (!fs.existsSync(path_deps) && auto_bootstrap) {
				await tasks.fetchDev(proj.uri.fsPath, output_channel, diagnostic_collection);
			}
		} catch {}
	}

	for (const [key, proj] of Object.entries(projects.build_alan)) {
		provideLanguageSupport(context, LSPContextType.alan, proj);
	}

	for (const [key, proj] of Object.entries(projects.versions_json)) {
		try {
			const path_deps = path.join(proj.uri.fsPath, ".alan");
			if (!fs.existsSync(path_deps) && auto_fetch) {
				await tasks.fetch(proj.uri.fsPath, output_channel, diagnostic_collection);
			}
		} finally {
			provideLanguageSupport(context, LSPContextType.fabric, proj);
		}
	}

	const is_alan_deploy_supported: boolean = isAlanDeploySupported();
	vscode.commands.executeCommand('setContext', 'alan.isAlanDeploySupported', is_alan_deploy_supported);

	const is_alan_appurl_provided: boolean = isAlanAppURLProvided();
	vscode.commands.executeCommand('setContext', 'alan.isAlanAppURLProvided', is_alan_appurl_provided);


	const alan_resolve_err = "Unable to resolve `alan` script.";
	const versionsjson_resolve_err = "Unable to resolve `versions.json` indicating the project root.";
	const projectjson_resolve_err = "Unable to resolve `project.json` indicating the project root.";
	let glob_script_args = {
		cmd: ""
	};
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider({
			"language": 'alan'
		}, {
			provideCompletionItems: (model, position) => {
				// const wordrange = model.getWordRangeAtPosition(position);
				const file = path.basename(model.fileName);
				let file_snippets = snippets.get(file);
				return {
					items: file_snippets
					// .map(s => {
					// 	// s.range = wordrange
					// 	return s;
					// })
				};
			}
		}),
		identifierCompletionItemProvider(),
		vscode.commands.registerCommand('alan.tasks.ls.manage', async () => {
			manageLanguageServers(clients);
		}),
		vscode.commands.registerCommand('alan.tasks.ls.restartall', async () => {
			restartAllLanguageServers(clients);
		}),
		vscode.commands.registerCommand('alan.tasks.package', (taskctx) => {
			const context_file: string = resolveContextFile(taskctx);
			if (context_file && path.basename(context_file) === 'deployment.alan') {
				tasks.package_deployment(context_file, output_channel, diagnostic_collection);
			} else {
				let error = 'Package command failed: `deployment.alan` file could not be resolved.';
				vscode.window.showErrorMessage(error);
			}
		}),
		vscode.commands.registerCommand('alan.tasks.generateMigration', async (taskctx) => {
			try {
				let alan_context = await resolveContext(taskctx, 'alan');
				tasks.generateMigration(await alan_context.context, await alan_context.root, output_channel, diagnostic_collection);
			} catch {
				let error = `Generate migration command failed. ${alan_resolve_err}`;
				vscode.window.showErrorMessage(error);
			}
		}),
		vscode.commands.registerCommand('alan.tasks.build', async (taskctx) => {
			try {
				let alan_context = await resolveContext(taskctx, 'alan');
				tasks.build(await alan_context.context, await alan_context.root, output_channel, clients.has(await alan_context.root) ? undefined : diagnostic_collection);
			} catch {
				let error = `Build command failed. ${alan_resolve_err}`;
				vscode.window.showErrorMessage(error);
			}
		}),
		vscode.commands.registerCommand('alan.tasks.fetch', async (taskctx) => {
			try {
				let project_root = await resolveContextRoot(taskctx, 'versions.json');
				const project_uri = vscode.Uri.file(project_root);

				/* check if it is a new or a known versions.json */
				if (projects.versions_json[project_root] === undefined) {
					/* register new project */
					projects.versions_json[project_root] = {
						uri: project_uri,
						workspace: vscode.workspace.getWorkspaceFolder(project_uri),
						subscriptions: []
					};
				}

				/* stop language client if it was running */
				let client = clients.get(project_root);
				if (client !== undefined) {
					await client.stop();
					await client.dispose();
					clients.delete(project_root);
				}

				/* fetch */
				await tasks.fetch(project_root, output_channel, diagnostic_collection);

				/* provide language support for the project */
				provideLanguageSupport(context, LSPContextType.fabric, projects.versions_json[project_root]);
			} catch {
				let error = `Fetch command failed. ${versionsjson_resolve_err}`;
				vscode.window.showErrorMessage(error);
			}
		}),
		vscode.commands.registerCommand('alan.tasks.deploy', async (taskctx) => {
			try {
				let alan_root = await resolveContextRoot(taskctx, 'deploy.sh');
				tasks.deploy(alan_root, output_channel, diagnostic_collection);
			} catch {
				let error = 'Deploy command failed. Unable to resolve `deploy.sh` script.';
				vscode.window.showErrorMessage(error);
			}
		}),
		vscode.commands.registerCommand('alan.tasks.show', async (taskctx) => {
			tasks.show();
		}),
		vscode.commands.registerCommand('alan.meta.tasks.script', async (taskctx) => {
			tasks.scriptDev(output_channel, diagnostic_collection, glob_script_args.cmd, taskctx[1]);
		}),
		vscode.commands.registerCommand('alan.meta.tasks.fetch', async (taskctx) => {
			try {
				let project_root = await resolveContextRoot(taskctx, 'project.json');
				const project_uri = vscode.Uri.file(project_root);

				/* check if it is a new or a known versions.json */
				let project_reg = projects.project_json[project_root];
				if (projects.project_json[project_root] === undefined) {
					/* register new project */
					projects.project_json[project_root] = {
						uri: project_uri,
						workspace: vscode.workspace.getWorkspaceFolder(project_uri),
						subscriptions: []
					};
				}

				/* fetch */
				await tasks.fetchDev(await project_root, output_channel, diagnostic_collection);

				/* just restart all language servers */
				restartAllLanguageServers(clients);
			} catch {
				let error = `Fetch command failed. ${projectjson_resolve_err}`;
				vscode.window.showErrorMessage(error);
			}
		}),
		vscode.commands.registerCommand('alan.meta.tasks.build', async (taskctx) => {
			try {
				let alan_context = await resolveContext(taskctx, 'project.json');
				tasks.buildDev(await alan_context.root, output_channel, clients.has(await alan_context.root) ? undefined : diagnostic_collection)
			} catch {
				let error = `Build command failed. ${projectjson_resolve_err}`;
				vscode.window.showErrorMessage(error);
			}
		}),
		vscode.commands.registerCommand('alan.meta.tasks.test', async (taskctx) => {
			try {
				let alan_context = await resolveContext(taskctx, 'project.json');
				tasks.testDev(await alan_context.root, output_channel, clients.has(await alan_context.root) ? undefined : diagnostic_collection)
			} catch {
				let error = `Test command failed. ${projectjson_resolve_err}`;
				vscode.window.showErrorMessage(error);
			}
		}),
		vscode.tasks.registerTaskProvider('alan', {
			provideTasks: async function () {
				try {
					const mixed_mode = Object.keys(projects.project_json).length > 0 && Object.keys(projects.versions_json).length > 0;
					if (mixed_mode) {
						return Promise.all([
							tasks.getTasksList(is_alan_deploy_supported, is_alan_appurl_provided),
							tasks.getTasksListDev(" (meta)")
						]).then((arr) => arr.flat());
					}
					else if (Object.keys(projects.versions_json).length > 0) {
						return tasks.getTasksList(is_alan_deploy_supported, is_alan_appurl_provided);
					}
					else if (Object.keys(projects.project_json).length > 0) {
						return tasks.getTasksListDev("");
					}
					else {
						return [];
					}
				} catch {
					return [];
				}
			},
			resolveTask(task: vscode.Task): vscode.Task | undefined {
				return undefined;
			}
		})
	);

	const fetch_statusbar_item: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 4);
	fetch_statusbar_item.command = 'alan.tasks.fetch';
	fetch_statusbar_item.text = 'Alan Fetch';
	fetch_statusbar_item.show();
	context.subscriptions.push(fetch_statusbar_item);

	const build_statusbar_item: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
	build_statusbar_item.command = 'alan.tasks.build';
	build_statusbar_item.text = 'Alan Build';
	build_statusbar_item.show();
	context.subscriptions.push(build_statusbar_item);

	if (is_alan_deploy_supported) {
		let deploy_statusbar_item: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2);
		deploy_statusbar_item.command = 'alan.tasks.deploy';
		deploy_statusbar_item.text = 'Alan Deploy';
		deploy_statusbar_item.show();
		context.subscriptions.push(deploy_statusbar_item);
	}

	if (is_alan_appurl_provided) {
		let show_statusbar_item: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
		show_statusbar_item.command = 'alan.tasks.show';
		show_statusbar_item.text = '$(browser) Alan Show';
		show_statusbar_item.show();
		context.subscriptions.push(show_statusbar_item);
	}
}