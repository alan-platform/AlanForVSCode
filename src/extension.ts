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
		vscode.commands.registerCommand('alan.tasks.package', tasks.package_deployment.bind(tasks.package_deployment, output_channel, diagnostic_collection)),
		vscode.commands.registerCommand('alan.tasks.generateMigration', tasks.generateMigration.bind(tasks.generateMigration, output_channel, diagnostic_collection)),
		vscode.commands.registerCommand('alan.tasks.build', tasks.build.bind(tasks.build, output_channel, diagnostic_collection)),
		vscode.window.registerTreeDataProvider('alanTreeView', new AlanTreeViewDataProvider(context)),
		vscode.tasks.registerTaskProvider('alan', {
			provideTasks: tasks.getTasksList,
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