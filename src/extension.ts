'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as sanitize from 'sanitize-filename';
import {fuzzyDefinitionSearch} from './search';
import {AlanTreeViewDataProvider} from './providers/AlanTreeView'

import * as proc from 'child_process';
import * as stripAnsiStream from 'strip-ansi-stream';


export function deactivate(context: vscode.ExtensionContext) {
    vscode.commands.executeCommand('setContext', 'isAlanFile', false);
}

export function activate(context: vscode.ExtensionContext) {
    let registrations: vscode.Disposable[] = [];

    function checkState() {
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId =="alan") {
            vscode.commands.executeCommand('setContext', 'isAlanFile', true);
        } else {
            vscode.commands.executeCommand('setContext', 'isAlanFile', false);
        }
    }
    checkState();

    registrations.push(vscode.commands.registerTextEditorCommand('editor.showDefinitions', editor => {
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
           "alan", {
                provideDefinition: fuzzyDefinitionSearch
            }
        ));
    }

    registrations.push(vscode.commands.registerCommand('input.migration.name', async function () {
        const bash_shell = resolveBashShell();
        const active_file_name = vscode.window.activeTextEditor.document.fileName;
        const active_file_dirname = path.dirname(active_file_name);

        return new Promise(resolve => {
            resolveAlanRoot(active_file_dirname).then(alan_root => {
                vscode.window.showInputBox({
                    value: 'from_empty',
                    valueSelection: [5,10],
                    placeHolder: `For example: <git commit id of 'from' model>`
                }).then(migration_name_raw => {
                    const migration_name = sanitize(migration_name_raw);
                    resolve(pathToBashPath(`${alan_root}/migrations/${migration_name}`, bash_shell));
                });
            });
        });
    }));

    registrations.push(vscode.commands.registerCommand('input.migration.model', async function () {
        const bash_shell = resolveBashShell();
        const active_file_name = vscode.window.activeTextEditor.document.fileName;
        const active_file_dirname = path.dirname(active_file_name);

        return new Promise(resolve => {
            resolveAlanRoot(active_file_dirname).then(alan_root => {
                const systems_dirs = fs.readdirSync(path.join(alan_root, "systems"))
                    .map(system => path.join(system, "model.lib.link"))
                    .filter(modellib => fs.existsSync(path.join(alan_root, "systems", modellib)));

                vscode.window.showQuickPick(systems_dirs, {
                    placeHolder: 'migration target model'
                }).then(migration_model => {
                    resolve(pathToBashPath(`${alan_root}/systems/${migration_model}`, bash_shell));
                });
            });
        });

    }));

    registrations.push(vscode.commands.registerCommand('input.migration.type', async function () {
        const migration_type_bootstrap = "initialization from empty dataset";
        const migration_type = await vscode.window.showQuickPick([
            migration_type_bootstrap,
            "mapping from target conformant dataset"
        ], {
            placeHolder: 'migration type'
        });

        return `${migration_type === migration_type_bootstrap ? "--bootstrap" : ""}`
    }));

    let diagnosticCollection = vscode.languages.createDiagnosticCollection();
    const channel = vscode.window.createOutputChannel('Alan');

    function executeCommand(shell_command: string, cwd: string, shell: string) {
        const spawn_opts: proc.SpawnOptions = { cwd: cwd };

        let child: proc.ChildProcess|undefined;
        child = proc.spawn(shell, ["-c", shell_command], spawn_opts);

        if (child) {
            child.on('error', err => {
                // TODO
            });

            let output_acc = "";

            channel.clear();
            channel.show(true);
            diagnosticCollection.clear();

            const stripped_stream = stripAnsiStream();
            stripped_stream.on('data', data => {
                let string: string = bashPathsToWinPaths(data.toString(), shell);
                channel.append(string);
                output_acc += string;
            });

            child.stdout.pipe(stripped_stream);
            child.stderr.pipe(stripped_stream);

            child.on('close', retc => {
                let diagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [];

                { // output parser
                    let current_diagnostic: vscode.Diagnostic | undefined;
                    const lines: String[] = output_acc.split("\n");
                    lines.forEach((line) => {
                        const re_range: RegExp = /^((?:\/|[a-zA-Z]:).*\.alan) from ([0-9]+):([0-9]+) to ([0-9]+):([0-9]+) (error|warning): (.*)/;
                        const re_locat: RegExp = /^((?:\/|[a-zA-Z]:).*\.alan) at ([0-9]+):([0-9]+) (error|warning): (.*)/;

                        function get_severity(severity: string): vscode.DiagnosticSeverity {
                            return severity == "error" ?
                                vscode.DiagnosticSeverity.Error : severity === "warning" ?
                                    vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information
                        }

                        const range_match = line.match(re_range);
                        if (range_match) {
                            const file = vscode.Uri.file(range_match[1]);
                            const line = parseInt(range_match[2], 10);
                            const column = parseInt(range_match[3], 10);
                            const endLine = parseInt(range_match[4], 10);
                            const endColumn = parseInt(range_match[5], 10);
                            const severity = range_match[6];
                            const message = range_match[7];

                            let range = new vscode.Range(line - 1, column - 1, endLine - 1, endColumn - 1);
                            current_diagnostic = new vscode.Diagnostic(range, message, get_severity(severity));
                            diagnostics.push([file, [current_diagnostic]]);
                            return;
                        }

                        const locat_match = line.match(re_locat);
                        if (locat_match) {
                            const file = vscode.Uri.file(range_match[1]);
                            const line = parseInt(range_match[2], 10);
                            const column = parseInt(range_match[3], 10);
                            const severity = range_match[4];
                            const message = range_match[5];

                            let range = new vscode.Range(line - 1, column - 1, line - 1, column - 1);
                            current_diagnostic = new vscode.Diagnostic(range, message, get_severity(severity));
                            diagnostics.push([file, [current_diagnostic]]);
                            return;
                        }

                        const re_link: RegExp = /^((?:\/|[a-zA-Z]:).*\.link) (error|warning): (.*)/;
                        const link_match = line.match(re_link);
                        if (link_match) {
                            const file = vscode.Uri.file(range_match[1]);
                            const severity = range_match[2];
                            const message = range_match[3];

                            let range = new vscode.Range(0, 0, 0, 0);
                            current_diagnostic = new vscode.Diagnostic(range, message, get_severity(severity));
                            diagnostics.push([file, [current_diagnostic]]);
                            return;
                        }

                        if (current_diagnostic && line.startsWith("\t")) {
                            current_diagnostic.message += '\n' + line;
                        }
                    });
                }

                diagnosticCollection.set(diagnostics);
            });
        } else {
            //TODO
        }
    }
    registrations.push(vscode.commands.registerCommand('alan.package', async function () {
        const shell = resolveBashShell();


        const active_file_name = vscode.window.activeTextEditor.document.fileName;
        const active_file_dirname = path.dirname(active_file_name);
        const active_file_dirname_bash = pathToBashPath(active_file_dirname, shell);
        const alan_root = await resolveAlanRoot(active_file_dirname);
        const alan_root_folder = pathToBashPath(alan_root, shell);

        executeCommand(`./alan package ./dist/project.pkg ${active_file_dirname_bash}`, alan_root_folder, shell);
    }));

    registrations.push(vscode.commands.registerCommand('alan.generateMigration', async function () {
        const shell = resolveBashShell();

        const active_file_name = vscode.window.activeTextEditor.document.fileName;
        const active_file_dirname = path.dirname(active_file_name);
        const alan_root = await resolveAlanRoot(active_file_dirname);
        const alan_root_folder = pathToBashPath(alan_root, shell);

        const name = await vscode.commands.executeCommand("input.migration.name");
        const model = await vscode.commands.executeCommand("input.migration.model");
        const type = await vscode.commands.executeCommand("input.migration.type");

        executeCommand(
            `${alan_root_folder}/.alan/dataenv/system-types/datastore/scripts/generate_migration.sh ${name} ${model} ${type}`
        , active_file_dirname, shell);
    }));

    registrations.push(vscode.commands.registerCommand('alan.build', async function () {
        const shell = resolveBashShell();

        const active_file_name = vscode.window.activeTextEditor.document.fileName;
        const active_file_dirname = path.dirname(active_file_name);
        const alan_root = await resolveAlanRoot(active_file_dirname);
        const alan = pathToBashPath(`${alan_root}/alan`, shell);

        executeCommand(`${alan} build`, active_file_dirname, shell);
    }));

    registrations.push(vscode.tasks.registerTaskProvider('alan', {
        provideTasks: () => {
            const bash_shell = resolveBashShell();
            return getAlanTasks(bash_shell);
        },
        resolveTask(task: vscode.Task): vscode.Task | undefined {
            return undefined;
        }
    }));

    registrations.push(vscode.window.registerTreeDataProvider(
        "alanTreeView",
        new AlanTreeViewDataProvider(context)
    ));

    context.subscriptions.push(...registrations);

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

    // spawn process:
    // https://github.com/vector-of-bool/vscode-cmake-tools/blob/develop/src/proc.ts
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
const wsl_bash = "C:\\Windows\\System32\\bash.exe";
// const wsl_bash = "c:\\windows\\sysnative\\bash.exe";
const git_bash_x64 = "C:\\Program Files\\Git\\bin\\bash.exe";
const git_bash_x32 = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
const linux_osx_bash = "/bin/bash";

function isWsl(shell: string) {
    return shell == wsl_bash;
}
function pathToBashPath(path : string, shell: string) {
    return path
        .replace(/([a-zA-Z]):/, isWsl(shell) ? "/mnt/$1" : "$1:") // replace drive: with /mnt/drive for WSL
        .replace(/\\/g, '/') //  convert backslashes from windows paths
        .replace(/ /g, '\\ '); // escape spaces
}

function bashPathsToWinPaths(string: string, shell: string) {
    if (isWsl(shell)) {
        return string.replace(/\/mnt\/([a-z])\//g, "$1:/");
    }
    return string;
}

function resolveBashShell() : string {
    const shell: string = vscode.workspace.getConfiguration('alan-definitions').get<string>('taskShell')
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
        return linux_osx_bash; //fallback to default
    }
}

async function resolveAlanRoot(file_dir: string) : Promise<string> {
    const {root} = path.parse(file_dir);

    return new Promise((resolve, reject) => {
        (async function find(curdir) {
            let alan_file = path.join(curdir,"alan");
            if (curdir === root) {
                reject(null);
            } else if (!await exists(alan_file)) {
                find(path.dirname(curdir));
            } else {
                return resolve(curdir);
            }
        })(file_dir);
    });
}

async function getAlanTasks(shell: string): Promise<vscode.Task[]> {
    const workspace_root = vscode.workspace.rootPath;
    const active_file_name = vscode.window.activeTextEditor.document.fileName;
    const active_file_dirname = path.dirname(active_file_name);

    let empty_tasks: vscode.Task[] = [];
    if (!workspace_root) {
        return empty_tasks;
    }

    return new Promise(resolve => {
        resolveAlanRoot(active_file_dirname).then(alan_root => {
            const alan_root_folder = pathToBashPath(alan_root, shell);
            const alan = pathToBashPath(`${alan_root}/alan`, shell);

            const result: vscode.Task[] = [];
            const default_options: vscode.ShellExecutionOptions = {
                "executable": shell, //custom or default
                "cwd": "${fileDirname}",
                "shellArgs": ["-c"]
            };
            const problemMatchers = ["$alanc-range", "$alanc-lc"];

            const fetch_task = new vscode.Task({
                type: "alan",
                task: "fetch"
            }, "fetch","alan", new vscode.ShellExecution(`${alan} fetch`, default_options), problemMatchers);
            fetch_task.group = vscode.TaskGroup.Clean; //??
            fetch_task.presentationOptions = {
                "clear": true,
                "reveal": vscode.TaskRevealKind.Always,
                "showReuseMessage": false,
                "focus": false
            };

            const build_task = new vscode.Task({
                type: "alan",
                task: "build"
            }, "build","alan", new vscode.ShellExecution("${command:alan.build}", default_options), problemMatchers);
            build_task.group = vscode.TaskGroup.Build;
            build_task.presentationOptions = {
                "clear": true,
                "reveal": vscode.TaskRevealKind.Always,
                "showReuseMessage": false,
                "focus": false
            };

            const migration_task = new vscode.Task({
                type: "alan",
                task: "generate migration"
            }, "generate migration","alan", new vscode.ShellExecution("${command:alan.generateMigration}", default_options), problemMatchers);
            migration_task.group = vscode.TaskGroup.Clean; //??
            migration_task.presentationOptions = {
                "clear": true,
                "reveal": vscode.TaskRevealKind.Always,
                "showReuseMessage": false,
                "focus": false
            };

            result.push(fetch_task);
            result.push(build_task);
            result.push(migration_task);

            if (path.basename(active_file_name) === "connections.alan") {
                const package_task = new vscode.Task({
                    type: "alan",
                    task: "package"
                }, "package","alan", new vscode.ShellExecution("${command:alan.package}", default_options), problemMatchers);
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