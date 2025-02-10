'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as tasks from './tasks';
import * as fs from 'fs';
import { showDefinitions, fuzzyDefinitionSearch } from './search';
import { AlanSymbolProvider } from './symbols'

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
	InsertTextFormat
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
}

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
	if (context && context._fsPath && pathIsFSPath(context._fsPath))
		return context._fsPath

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
	} else if (vscode.workspace.workspaceFolders) {
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

async function startLanguageServer(context: vscode.ExtensionContext, project_root: vscode.Uri, workspace_folder: vscode.WorkspaceFolder, language_server: string) {
	const serverOptions: ServerOptions = {
		command: language_server,
		args: ['--lsp'],
		transport: TransportKind.stdio,
		options: {
			cwd: project_root.fsPath,
		}
	};

	const capture: string = vscode.workspace.getConfiguration('alan-definitions').get<string>('alan-capture');
	if (capture && capture !== null && capture !== '') {
		serverOptions.args.push("--capture", capture);
	}

	const clientOptions: LanguageClientOptions = {
		documentSelector: [getDocumentFilterForPath(project_root)],
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
			uri: project_root,
			name: `name${clients.size}`,
			index: workspace_folder.index
		}
	};

	const client = new LanguageClient(`alan-language-server${clients.size}`, serverOptions, clientOptions);
	clients.set(project_root.fsPath, client);

	client.onDidChangeState((e) => {
		// console.log(`state: ${e.oldState} => ${e.newState}`);
		switch (e.newState) {
			case State.Stopped:
				clients.delete(project_root.fsPath);
				useLegacyImpl(context, project_root);
				break;
			case State.Running:
			case State.Starting:
				break;
		}
	});
	await client.start();

	return client.state != State.Stopped;
}

/*
TODO:
- watch for creation of 'tool' file
- if server stops because of missing files, restart when created? or server should watch itself...
*/

async function startTool(context: vscode.ExtensionContext, conf: string, project_root: vscode.Uri, workspace_folder: vscode.WorkspaceFolder) {
	let tool_conf: string = vscode.workspace.getConfiguration('alan-definitions').get(conf);
	if (process.platform === 'win32')
		tool_conf += `.exe`;

	const tool: string = path.resolve(project_root.fsPath, tool_conf);

	try {
		fs.accessSync(tool, fs.constants.X_OK);
		startLanguageServer(context, project_root, workspace_folder, tool);
		return true;
	} catch {
		return false;
	}
}

async function useLegacyImpl(context: vscode.ExtensionContext, path: vscode.Uri) {
	if (vscode.workspace.getConfiguration('alan-definitions').get<boolean>('integrateWithGoToDefinition')) {
		context.subscriptions.push(vscode.languages.registerDefinitionProvider(getDocumentFilterForPath(path), {
			provideDefinition: fuzzyDefinitionSearch
		}));
	}
	context.subscriptions.push(vscode.commands.registerTextEditorCommand('alan.editor.showDefinitions', showDefinitions));

	const symbol_provider = new AlanSymbolProvider();

	vscode.languages.registerDocumentSymbolProvider(getDocumentFilterForPath(path), symbol_provider),
		vscode.languages.registerCompletionItemProvider(getDocumentFilterForPath(path), {
			provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
				const wrange = document.getWordRangeAtPosition(position, /'[^']*'/);
				if (!wrange)
					return undefined; //fall back to built-in wordenize; OPT: combine results below with wordenize results

				return symbol_provider.provideDocumentSymbols(document, token).then(symbols => {
					let result: Map<string, vscode.CompletionItem> = new Map();
					function flatten(symvs: vscode.DocumentSymbol[]) {
						symvs.forEach(sym => {
							function mapSymbolKind2CompletionItemKind(kind: vscode.SymbolKind) {
								switch (kind) {
									case vscode.SymbolKind.File:
										return vscode.CompletionItemKind.File;
									case vscode.SymbolKind.Module:
										return vscode.CompletionItemKind.Module;
									case vscode.SymbolKind.Namespace:
										return vscode.CompletionItemKind.Module;
									case vscode.SymbolKind.Class:
										return vscode.CompletionItemKind.Class;
									case vscode.SymbolKind.Method:
										return vscode.CompletionItemKind.Method;
									case vscode.SymbolKind.Enum:
										return vscode.CompletionItemKind.Enum;
									case vscode.SymbolKind.Interface:
										return vscode.CompletionItemKind.Interface;
									case vscode.SymbolKind.Function:
										return vscode.CompletionItemKind.Function;
									case vscode.SymbolKind.Variable:
										return vscode.CompletionItemKind.Variable;
									case vscode.SymbolKind.Constant:
										return vscode.CompletionItemKind.Constant;
									case vscode.SymbolKind.String:
										return vscode.CompletionItemKind.Text;
									case vscode.SymbolKind.Number:
										return vscode.CompletionItemKind.Constant;
									case vscode.SymbolKind.Array:
										return vscode.CompletionItemKind.Property;
									case vscode.SymbolKind.Event:
										return vscode.CompletionItemKind.Event;
									case vscode.SymbolKind.Operator:
										return vscode.CompletionItemKind.Operator;
									case vscode.SymbolKind.TypeParameter:
										return vscode.CompletionItemKind.TypeParameter;
									case vscode.SymbolKind.Struct:
										return vscode.CompletionItemKind.Struct;
									case vscode.SymbolKind.EnumMember:
										return vscode.CompletionItemKind.EnumMember;
									default:
										return vscode.CompletionItemKind.Struct;
								}
							}
							const existing_citem = result[sym.name];
							const ckind = mapSymbolKind2CompletionItemKind(sym.kind);
							if (existing_citem && existing_citem.kind === ckind) {
								//skip
							} else if (existing_citem && existing_citem.kind === vscode.CompletionItemKind.Struct) {
								existing_citem.kind = ckind;
							} else {
								let item = new vscode.CompletionItem(sym.name, ckind);
								item.insertText = `'${sym.name}'`;
								item.filterText = `'${sym.name}'`;
								item.detail = sym.detail;
								item.range = wrange;
								result.set(sym.name, item);
							}
							flatten(sym.children);
						});
					}

					flatten(symbols);
					return Array.from(result.values());
				});
			}
		}, '\'')
}


export function deactivate(): Thenable<void> | undefined {
	vscode.commands.executeCommand('setContext', 'alan.isAlanDeploySupported', false);
	vscode.commands.executeCommand('setContext', 'alan.isAlanAppURLProvided', false);

	const promises: Thenable<void>[] = [];
	for (const client of clients.values()) {
		promises.push(client.stop());
	}
	return Promise.all(promises).then(() => undefined);
}
export async function activate(context: vscode.ExtensionContext) {
	const diagnostic_collection = vscode.languages.createDiagnosticCollection();
	const output_channel = vscode.window.createOutputChannel('Alan');

	const auto_bootstrap: boolean = vscode.workspace.getConfiguration('alan-definitions').get('alan-auto-bootstrap');
	const auto_fetch: boolean = vscode.workspace.getConfiguration('alan-definitions').get('fabric-auto-fetch');

	const walk = (dir, onfile: (err: NodeJS.ErrnoException | null, file?: string, type?: LSPContextType) => void) => {
		let results = {
			alan: [],
			fabric: []
		};
		fs.readdir(dir, (err, list) => {
			if (err) return onfile(err);
			list.forEach((fname) => {
				const file = path.resolve(dir, fname);
				fs.stat(file, function (err, stat) {
					if (stat && stat.isDirectory()) {
						walk(file, onfile);
					} else {
						if (fname === "project.json") {
							onfile(null, file, LSPContextType.alan);
						}
						else if (fname === "versions.json") {
							onfile(null, file, LSPContextType.fabric);
						}
					}
				});
			});
		});
	};

	for (const workspace of vscode.workspace.workspaceFolders) {
		walk(workspace.uri.fsPath, async (err, file, type) => {
			if (err) {
				console.error(err);
			}
			else {
				const project_root = vscode.Uri.parse(path.dirname(file));
				try {
					switch (type) {
						case LSPContextType.alan: {
							const path_deps = path.join(project_root.fsPath, "dependencies");
							if (!fs.existsSync(path_deps) && auto_bootstrap) {
								await tasks.bootstrap(project_root.fsPath, output_channel, diagnostic_collection);
							}
						} break;
						case LSPContextType.fabric: {
							const path_deps = path.join(project_root.fsPath, ".alan");
							if (!fs.existsSync(path_deps) && auto_fetch) {
								await tasks.fetch(project_root.fsPath, output_channel, diagnostic_collection);
							}
						} break;
					}
					startTool(context, type, project_root, workspace);
				} catch {
					useLegacyImpl(context, project_root);
				}
			}
		});
	}

	const is_alan_deploy_supported: boolean = isAlanDeploySupported();
	vscode.commands.executeCommand('setContext', 'alan.isAlanDeploySupported', is_alan_deploy_supported);

	const is_alan_appurl_provided: boolean = isAlanAppURLProvided();
	vscode.commands.executeCommand('setContext', 'alan.isAlanAppURLProvided', is_alan_appurl_provided);


	/* set contexts for the Alan Package command */
	vscode.commands.executeCommand('setContext', 'alan.deploymentPackagingContexts', tasks.deploymentPackagingContexts);

	const alan_resolve_err = "Unable to resolve `alan` script.";
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
		vscode.commands.registerCommand('alan.tasks.package', (taskctx) => {
			const context_file = resolveContextFile(taskctx); // (connections.alan) file determines which deployment to build
			if (context_file) {
				tasks.package_deployment(context_file, output_channel, diagnostic_collection);
			} else {
				let error = 'Package command failed: context `connections.alan` file could not be resolved.';
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
				let alan_root = await resolveContextRoot(taskctx, 'alan');
				tasks.fetch(alan_root, output_channel, diagnostic_collection);
			} catch {
				let error = `Fetch command failed. ${alan_resolve_err}`;
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
		vscode.commands.registerCommand('alan.dev.tasks.script', async (taskctx) => {
			tasks.scriptDev(output_channel, diagnostic_collection, glob_script_args.cmd, taskctx[1]);
		}),
		vscode.commands.registerCommand('alan.dev.tasks.build', tasks.buildDev.bind(tasks.buildDev, output_channel, undefined)),
		vscode.commands.registerCommand('alan.dev.tasks.test', tasks.testDev.bind(tasks.testDev, output_channel, diagnostic_collection)),

		vscode.tasks.registerTaskProvider('alan', {
			provideTasks: async function () {
				try { // alan projects
					let alan_root = await resolveContextRoot(undefined, 'alan');
					return tasks.getTasksList(alan_root, is_alan_deploy_supported, is_alan_appurl_provided);
				} catch {
					try { // alan dev/meta projects
						let alan_root = await resolveContextRoot(undefined, 'project.json');
						return tasks.getTasksListDev(alan_root);
					} catch {
						return [];
					}
				}
			},
			resolveTask(task: vscode.Task): vscode.Task | undefined {
				return undefined;
			}
		}),

		vscode.tasks.registerTaskProvider('alan-script', {
			provideTasks: async function () {
				return [
					new vscode.Task(
						{
							'type': 'alan-script',
							'task': 'shell',
							'command': `./test.sh`
						},
						vscode.TaskScope.Workspace,
						'script',
						'alan',
						new vscode.ShellExecution(`./test.sh`, {}),
						[]
					)
				];
				// const tasks = await fs.promises
				// 	.readdir(this.workspaceRoot)
				// 	.then(files =>
				// 		files.filter(f => path.extname(f) == ".sh").map(f => new vscode.Task(
				// 			{
				// 				'type': 'alan-script',
				// 				'task': 'shell',
				// 				'command': `./${f}`
				// 			},
				// 			vscode.TaskScope.Workspace,
				// 			'script',
				// 			'alan',
				// 			new vscode.ShellExecution(`./${f}`, {}),
				// 			[]
				// 		)));
				// return tasks;
			},
			resolveTask(_task: vscode.Task): vscode.Task | undefined {
				const cmd = (<any>_task.definition).command;
				glob_script_args.cmd = cmd;
				return new vscode.Task(
					_task.definition,
					vscode.TaskScope.Workspace,
					'test-trans',
					'alan',
					new vscode.ShellExecution('${command:alan.dev.tasks.script}', {}),
					[]
				);
				return undefined;
			}
		}),
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