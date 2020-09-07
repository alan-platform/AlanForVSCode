'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as tasks from './tasks';
import {showDefinitions, fuzzyDefinitionSearch} from './search';
import {AlanSymbolProvider} from './symbols'

function isAlanDeploySupported() : boolean {
	if (process.env.CONTAINER_NAME && process.env.DEPLOY_HOST && process.env.DEPLOY_PORT) {
		vscode.commands.executeCommand('setContext', 'isAlanDeploySupported', true);
		return true;
	} else {
		vscode.commands.executeCommand('setContext', 'isAlanDeploySupported', false);
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

export function deactivate(context: vscode.ExtensionContext) {
	vscode.commands.executeCommand('setContext', 'isAlanDeploySupported', false);
}
export function activate(context: vscode.ExtensionContext) {
	const diagnostic_collection = vscode.languages.createDiagnosticCollection();
	const output_channel = vscode.window.createOutputChannel('Alan');
	const is_alan_deploy_supported: boolean = isAlanDeploySupported();
	const symbol_provider = new AlanSymbolProvider();

	// pretend to be a definition provider
	if (vscode.workspace.getConfiguration('alan-definitions').get<boolean>('integrateWithGoToDefinition')) {
		context.subscriptions.push(vscode.languages.registerDefinitionProvider('alan', {
			provideDefinition: fuzzyDefinitionSearch
		}));
	}

	const alan_resolve_err = "Unable to resolve `alan` tool.";
	context.subscriptions.push(
		vscode.commands.registerTextEditorCommand('alan.editor.showDefinitions', showDefinitions),

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
				tasks.build(await alan_context.context, await alan_context.root, output_channel, diagnostic_collection);
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
				tasks.deploy(alan_root, output_channel, diagnostic_collection)
			} catch {
				let error = 'Deploy command failed. Unable to resolve `deploy.sh` script.';
				vscode.window.showErrorMessage(error);
			}
		}),

		vscode.commands.registerCommand('alan.dev.tasks.build', tasks.buildDev.bind(tasks.buildDev, output_channel, diagnostic_collection)),
		vscode.commands.registerCommand('alan.dev.tasks.test', tasks.testDev.bind(tasks.testDev, output_channel, diagnostic_collection)),

		vscode.tasks.registerTaskProvider('alan', {
			provideTasks: async function () {
				try { // alan projects
					let alan_root = await resolveContextRoot(undefined, 'alan');
					return tasks.getTasksList(alan_root, is_alan_deploy_supported);
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

		vscode.languages.registerDocumentSymbolProvider({ language: 'alan' }, symbol_provider)
	);

	const fetch_statusbar_item: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
	fetch_statusbar_item.command = 'alan.tasks.fetch';
	fetch_statusbar_item.text = 'Alan Fetch';
	fetch_statusbar_item.show();
	context.subscriptions.push(fetch_statusbar_item);

	const build_statusbar_item: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
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
}