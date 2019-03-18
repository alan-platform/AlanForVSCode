'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {fuzzyDefinitionSearch} from './search';
import { AlanTreeViewDataProvider } from './providers/AlanTreeView'

//This extension is based on Fuzzy Definitions from Johannes Rieken

export function deactivate(context: vscode.ExtensionContext) {
    vscode.commands.executeCommand('setContext', 'isAlanFile', false);
}

export function activate(context: vscode.ExtensionContext) {
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
    if (vscode.workspace.getConfiguration('alan-definitions').get<boolean>('integrateWithGoToDefinition')) {
        registrations.push(vscode.languages.registerDefinitionProvider(
            'alan', {
                provideDefinition: fuzzyDefinitionSearch
            }
        ));
    }

    vscode.tasks.registerTaskProvider('alan', {
        provideTasks: () => {
            const bash_shell = resolveBashShell(vscode.workspace.getConfiguration('alan-definitions').get<string>('taskShell'));
            return getAlanTasks(bash_shell);
        },
        resolveTask(task: vscode.Task): vscode.Task | undefined {
            return undefined;
        }
    });

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

function exists(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => {
		fs.exists(file, (value) => {
			resolve(value);
		});
	});
}

const wsl = "C:\\Windows\\System32\\wsl.exe";
const wsl_bash = "c:\\windows\\sysnative\\bash.exe";
const git_bash_x64 = "C:\\Program Files\\Git\\bin\\bash.exe"
const git_bash_x32 = "C:\\Program Files (x86)\\Git\\bin\\bash.exe"

function isWsl(shell: string) {
    return shell == wsl_bash;
}
function normalizePath(path : string, shell: string) {
    return path
        .replace(/([a-zA-Z]):/, isWsl(shell) ? "/mnt/$1" : "$1:") // replace drive: with /mnt/drive for WSL
        .replace(/\\/g, '/') //  convert backslashes from windows paths
        .replace(/ /g, '\\ '); // escape spaces
}

// bash shell detection
function resolveBashShell(shell: string) : string {
    if (shell && shell !== null && shell !== "") {
        return shell;
    } else if (process.platform === 'win32') {
        if (fs.existsSync(wsl)) {
            return wsl_bash;
        } else if (fs.existsSync(git_bash_x64)) {
            return git_bash_x64;
        } else if (fs.existsSync(git_bash_x32)) {
            return git_bash_x32;
        } else {
            let error = "Could not locate a bash shell for executing Alan tasks. Please set one in the extension's settings.";
            const selectedItem = vscode.window.showErrorMessage(error);
            return undefined;
        }
    } else {
        return undefined; //fallback to default
    }
}

async function resolveAlan(file_dir: string) : Promise<string> {
    const {root} = path.parse(file_dir);

    return new Promise((resolve, reject) => {
        (async function find(curdir) {
            let alanFile = path.join(curdir, "alan");
            if (curdir === root) {
                reject(null);
            } else if (!await exists(alanFile)) {
                find(path.dirname(curdir));
            } else {
                return resolve(alanFile);
            }
        })(file_dir);
    });
}

async function getAlanTasks(shell: string): Promise<vscode.Task[]> {
    const workspaceRoot = vscode.workspace.rootPath;
    const activeFileName = vscode.window.activeTextEditor.document.fileName;
    const activeFileDirName = path.dirname(activeFileName);
    const active_file_dirname_bash = normalizePath(activeFileDirName, shell);

    let emptyTasks: vscode.Task[] = [];
    if (!workspaceRoot) {
        return emptyTasks;
    }

    const alanFile: Promise<string> = resolveAlan(activeFileDirName);

    return new Promise(resolve => {
        alanFile.then(alan_raw => {
            const alan_root_folder = normalizePath(path.dirname(alan_raw), shell);
            const alan = normalizePath(alan_raw, shell);
            const wsl_convert = isWsl(shell) ? " | sed -e 's@/mnt/\\([a-z]\\)@\\1:@g'" : "";
            const convert_output = ` 2>&1 | sed ':begin;$!N;s@\\n\\t\\+@ @;tbegin;P;D'${wsl_convert}`; //hack while vscode does not support it via a problemmatcher

            const result: vscode.Task[] = [];
            const default_options: vscode.ShellExecutionOptions = {
                "executable": shell, //custom or default
                "cwd": "${fileDirname}",
                "shellArgs": ["-c"]
            };
            const problemMatchers = ["$alanc-range", "$alanc-lc"];

            const fetch_task = new vscode.Task({
                type: 'alan',
                task: "fetch"
            }, "fetch", "alan", new vscode.ShellExecution(`${alan} fetch`, default_options), problemMatchers);
            fetch_task.group = vscode.TaskGroup.Clean; //??
            fetch_task.presentationOptions = {
                "clear": true,
                "reveal": vscode.TaskRevealKind.Always,
                "showReuseMessage": false,
                "focus": false
            };

            const build_task = new vscode.Task({
                type: 'alan',
                task: "build"
            }, "build", "alan", new vscode.ShellExecution(`${alan} build${convert_output}`, default_options), problemMatchers);
            build_task.group = vscode.TaskGroup.Build;
            build_task.presentationOptions = {
                "clear": true,
                "reveal": vscode.TaskRevealKind.Always,
                "showReuseMessage": false,
                "focus": false
            };

            const migration_bootstrap_task = new vscode.Task({
                type: 'alan',
                task: "generate migration from empty dataset"
            }, "generate migration from empty dataset", "alan", new vscode.ShellExecution(`${alan_root_folder}/.alan/dataenv/system-types/datastore/scripts/generate_migration.sh ${alan_root_folder}/migrations/from_empty ${alan_root_folder}/systems/server/model.lib.link --bootstrap${convert_output}`, default_options), problemMatchers);
            migration_bootstrap_task.group = vscode.TaskGroup.Clean; //??
            migration_bootstrap_task.presentationOptions = {
                "clear": true,
                "reveal": vscode.TaskRevealKind.Always,
                "showReuseMessage": false,
                "focus": false
            };

            result.push(fetch_task);
            result.push(build_task);
            result.push(migration_bootstrap_task);

            if (path.basename(activeFileName) === "migration.alan") {
                const migration_task = new vscode.Task({
                    type: 'alan',
                    task: "regenerate migration using from/application.alan"
                }, "regenerate migration using from/application.alan", "alan", new vscode.ShellExecution(`${alan_root_folder}/.alan/dataenv/system-types/datastore/scripts/generate_migration.sh ${active_file_dirname_bash} ${alan_root_folder}/systems/server/model.lib.link${convert_output}`, default_options), problemMatchers);
                migration_task.group = vscode.TaskGroup.Clean; //??
                migration_task.presentationOptions = {
                    "clear": true,
                    "reveal": vscode.TaskRevealKind.Always,
                    "showReuseMessage": false,
                    "focus": false
                };
                result.push(migration_task);
            }

            if (path.basename(activeFileName) === "connections.alan") {
                const package_task = new vscode.Task({
                    type: 'alan',
                    task: "package"
                }, "package", "alan", new vscode.ShellExecution(`./alan package ./dist/project.pkg ${active_file_dirname_bash}${convert_output}`, default_options), problemMatchers);
                package_task.execution.options.cwd = alan_root_folder;
                package_task.group = vscode.TaskGroup.Build;
                package_task.presentationOptions = {
                    "clear": true,
                    "reveal": vscode.TaskRevealKind.Always,
                    "showReuseMessage": false,
                    "focus": false
                };
                result.push(package_task);
            }

            resolve(result);
        }, () => resolve([]));
    });
}