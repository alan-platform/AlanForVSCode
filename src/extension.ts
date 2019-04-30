'use strict';

import * as vscode from 'vscode';
import * as tasks from './tasks';
import {showDefinitions, fuzzyDefinitionSearch} from './search';
import {AlanTreeViewDataProvider} from './providers/AlanTreeView'

function checkState() {
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'alan') {
        vscode.commands.executeCommand('setContext', 'isAlanFile', true);
    } else {
        vscode.commands.executeCommand('setContext', 'isAlanFile', false);
    }
}
function getContextResource(context, onResource) {
	if (context && context._fsPath) {
		onResource(context._fsPath);
	} else if (vscode.window.activeTextEditor.document.fileName) {
		onResource(vscode.window.activeTextEditor.document.fileName);
	} else {
		let error = 'Command execution failed: missing context resource for command.';
		vscode.window.showErrorMessage(error);
	}
}

export function deactivate(context: vscode.ExtensionContext) {
	vscode.commands.executeCommand('setContext', 'isAlanFile', false);
}
export function activate(context: vscode.ExtensionContext) {
	const diagnostic_collection = vscode.languages.createDiagnosticCollection();
	const output_channel = vscode.window.createOutputChannel('Alan');

	checkState();

	// pretend to be a definition provider
	if (vscode.workspace.getConfiguration('alan-definitions').get<boolean>('integrateWithGoToDefinition')) {
		context.subscriptions.push(vscode.languages.registerDefinitionProvider('alan', {
			provideDefinition: fuzzyDefinitionSearch
		}));
	}

	context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('alan.editor.showDefinitions', showDefinitions),
		vscode.commands.registerCommand('alan.tasks.package', (taskctx) => {
			getContextResource(taskctx, src => tasks.package_deployment(src, output_channel, diagnostic_collection));
		}),
		vscode.commands.registerCommand('alan.tasks.generateMigration', tasks.generateMigration.bind(tasks.generateMigration, output_channel, diagnostic_collection)),
		vscode.commands.registerCommand('alan.tasks.build', (taskctx) => {
			getContextResource(taskctx, src => tasks.build(src, output_channel, diagnostic_collection));
		}),
		vscode.commands.registerCommand('alan.tasks.fetch', (taskctx) => {
			getContextResource(taskctx, src => tasks.fetch(src, output_channel, diagnostic_collection));
		}),
		vscode.commands.registerCommand('alan.dev.tasks.build', tasks.buildDev.bind(tasks.buildDev, output_channel, diagnostic_collection)),
		vscode.commands.registerCommand('alan.dev.tasks.test', tasks.testDev.bind(tasks.testDev, output_channel, diagnostic_collection)),
		vscode.window.registerTreeDataProvider('alanTreeView', new AlanTreeViewDataProvider(context)),
		vscode.tasks.registerTaskProvider('alan', {
			provideTasks: async function () {
				const active_file_name = vscode.window.activeTextEditor.document.fileName;
				const active_file_dirname = require('path').dirname(active_file_name);

				try { // alan projects
					const alan_root = await tasks.resolveRoot(active_file_dirname, 'alan');
					return tasks.getTasksList(alan_root);
				} catch {
					try { // alan dev/meta projects
						const dev_root = await tasks.resolveRoot(active_file_dirname, 'project.json');
						return tasks.getTasksListDev(dev_root);
					} catch {
						return [];
					}
				}
			},
			resolveTask(task: vscode.Task): vscode.Task | undefined {
				return undefined;
			}
		}));

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			checkState();
        }, null, context.subscriptions),
        vscode.workspace.onDidOpenTextDocument(() => {
			checkState();
        }, null, context.subscriptions),
        vscode.workspace.onDidCloseTextDocument(() => {
			if (vscode.window.visibleTextEditors.length < 1) {
				vscode.commands.executeCommand('setContext', 'isAlanFile', false);
			}
		}, null, context.subscriptions));
}