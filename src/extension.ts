'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as tasks from './tasks';
import {showDefinitions, fuzzyDefinitionSearch} from './search';
import {AlanTreeViewDataProvider} from './providers/AlanTreeView'

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

	if (pathIsFSPath(vscode.window.activeTextEditor.document.uri.fsPath))
		return vscode.window.activeTextEditor.document.uri.fsPath;

	return undefined;
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

class AlanSymbolProvider implements vscode.DocumentSymbolProvider {
	public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Thenable<vscode.DocumentSymbol[]> {
		return new Promise((resolve, reject) => {
			var re = /^(\s*)(('[^']*')|([a-z]+[a-z\-\_]+))/;

			function createItem(name: string, line: vscode.TextLine | undefined, offset: number): vscode.DocumentSymbol {
				return {
					'name': name,
					'detail': name,
					'kind': vscode.SymbolKind.Class,
					'range': new vscode.Range(new vscode.Position(line.range.start.line, offset), new vscode.Position(line.range.start.line, offset + name.length)),
					'selectionRange': new vscode.Range(new vscode.Position(line.range.start.line, offset), new vscode.Position(line.range.start.line, offset + name.length)),
					'children': []
				};
			}

			const root_node = { 'children': [] };
			let stack = [{ 'item': root_node, 'level': -1 }];

			for (var i = 0; i < document.lineCount; i++) {
				const line = document.lineAt(i);
				var matches = line.text.match(re);
				if (matches !== null && matches.length >= 3 && matches[2] !== "") {
					const my_level = matches[1].length;
					while (my_level <= stack[stack.length - 1].level)
						stack.pop();

					const parent_node = stack[stack.length - 1].item;
					var new_node = createItem(matches[2], line, my_level);
					parent_node.children.push(new_node);
					stack.push({ 'item': new_node, 'level': my_level});
				}
			}
			resolve(root_node.children);
		});
	}
}

export function deactivate(context: vscode.ExtensionContext) {
	vscode.commands.executeCommand('setContext', 'isAlanDeploySupported', false);
}
export function activate(context: vscode.ExtensionContext) {
	const diagnostic_collection = vscode.languages.createDiagnosticCollection();
	const output_channel = vscode.window.createOutputChannel('Alan');
	const is_alan_deploy_supported: boolean = isAlanDeploySupported();

	// pretend to be a definition provider
	if (vscode.workspace.getConfiguration('alan-definitions').get<boolean>('integrateWithGoToDefinition')) {
		context.subscriptions.push(vscode.languages.registerDefinitionProvider('alan', {
			provideDefinition: fuzzyDefinitionSearch
		}));
	}

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
		vscode.commands.registerCommand('alan.tasks.generateMigration', (taskctx) => {
			const context_file = resolveContextFile(taskctx);
			if (context_file) {
				tasks.generateMigration(context_file, output_channel, diagnostic_collection);
			} else {
				let error = 'Generate migration command failed: context alan file could not be resolved.';
				vscode.window.showErrorMessage(error);
			}
		}),
		vscode.commands.registerCommand('alan.tasks.build', (taskctx) => {
			const context_file = resolveContextFile(taskctx);
			if (context_file) {
				tasks.build(context_file, output_channel, diagnostic_collection)
			} else {
				let error = 'Build command failed: context alan file could not be resolved.';
				vscode.window.showErrorMessage(error);
			}
		}),
		vscode.commands.registerCommand('alan.tasks.fetch', async (taskctx) => {
			try {
				let alan_root = await resolveContextRoot(taskctx, 'alan');
				tasks.fetch(alan_root, output_channel, diagnostic_collection);
			} catch {
				let error = 'Fetch command failed. Unable to resolve `alan` script.';
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

		vscode.window.registerTreeDataProvider('alanTreeView', new AlanTreeViewDataProvider(context)),
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

		vscode.languages.registerDocumentSymbolProvider({ language: 'alan' }, new AlanSymbolProvider())
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
	context.subscriptions.push(
		build_statusbar_item,
		vscode.window.onDidChangeActiveTextEditor(() => {
			if (vscode.window.activeTextEditor.document.languageId === 'alan') {
				build_statusbar_item.show();
			} else {
				build_statusbar_item.hide();
			}
		})
	);

	if (is_alan_deploy_supported) {
		let deploy_statusbar_item: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2);
		deploy_statusbar_item.command = 'alan.tasks.deploy';
		deploy_statusbar_item.text = 'Alan Deploy';
		deploy_statusbar_item.show();
		context.subscriptions.push(deploy_statusbar_item);
	}
}