'use strict';

import * as vscode from 'vscode';
import {fuzzyDefinitionSearch} from './search';

import { AlanTreeViewDataProvider } from './providers/AlanTreeView'

//This extension is based on Fuzzy Definitions from Johannes Rieken

export function deactivate(context: vscode.ExtensionContext) {
    vscode.commands.executeCommand('setContext', 'isAlanFile', false);
}

export function activate(context: vscode.ExtensionContext) {

    let config = vscode.workspace.getConfiguration('alan-definitions');
    let registrations: vscode.Disposable[] = [];

    function checkState() {
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId == "alan") {
            vscode.commands.executeCommand('setContext', 'isAlanFile', true);
        } else {
            vscode.commands.executeCommand('setContext', 'isAlanFile', false);
        }
    }
    checkState();

    registrations.push(vscode.commands.registerTextEditorCommand('editor.gotoAlanDefinitions', editor => {

        let {document, selection} = editor;

        return fuzzyDefinitionSearch(document, selection.active, new vscode.CancellationTokenSource().token).then(locations => {

            if (!locations || locations.length === 0) {
                let range = document.getWordRangeAtPosition(selection.active);
                let message = range ? 'unable to find' : 'unable to find ' + document.getText(range);
                vscode.window.setStatusBarMessage(message, 1500);
                return;
            }

            if (locations.length === 1) {
                return openLocation(locations[0]);
            }

            let picks = locations.map(l => ({
                label: `${vscode.workspace.asRelativePath(l.uri)}:${l.range.start.line + 1}`,
                description: l.uri.fsPath,
                location: l
            }));

            return vscode.window.showQuickPick(picks).then(pick => {
                return pick && openLocation(pick.location);
            });
        });
    }));

    // pretend to be a definition provider
    if (config.get<boolean>('integrateWithGoToDefinition')) {
        registrations.push(vscode.languages.registerDefinitionProvider(
            'alan', {
                provideDefinition: fuzzyDefinitionSearch
            }
        ));
    }

    context.subscriptions.push(...registrations);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
            "alanTreeView",
            new AlanTreeViewDataProvider(context)
        )
    );
   
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            checkState();
        }, null, context.subscriptions ) 
    );   
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(() => {
            checkState();
        }, null, context.subscriptions ) 
    );
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(() => {
            if (vscode.window.visibleTextEditors.length < 1) {
                vscode.commands.executeCommand('setContext', 'isAlanFile', false);
            }
        }, null, context.subscriptions ) 
    );
}

function openLocation(location: vscode.Location) {
    return vscode.workspace.openTextDocument(location.uri).then(doc => {
        return vscode.window.showTextDocument(doc).then(editor => {
            editor.revealRange(location.range);
        });
    });
}
