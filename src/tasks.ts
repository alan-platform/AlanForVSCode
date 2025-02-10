'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as proc from 'child_process';
import sanitize from 'sanitize-filename';

const wsl = 'C:\\Windows\\System32\\wsl.exe';
const wsl_bash = 'C:\\Windows\\System32\\bash.exe';
const git_bash_x64 = 'C:\\Program Files\\Git\\bin\\bash.exe';
const git_bash_x32 = 'C:\\Program Files (x86)\\Git\\bin\\bash.exe';
const linux_osx_bash = '/bin/bash';

export const deploymentPackagingContexts = {
	"connections.alan": "platform <= 2021.10",
	"deployment.alan": "platform >= 2021.8"
}

function isWsl(shell: string) {
	return shell == wsl_bash;
}
function pathToBashPath(path : string, shell: string) {
	return path
		.replace(/([a-zA-Z]):/, isWsl(shell) ? '/mnt/$1' : '$1:') // replace drive: with /mnt/drive for WSL
		.replace(/\\/g, '/') //  convert backslashes from windows paths
		.replace(/ /g, '\\ '); // escape spaces
}
function bashPathsToWinPaths(string: string, shell: string) {
	if (isWsl(shell)) {
		return string.replace(/\/mnt\/([a-z])\//g, '$1:/');
	}
	return string;
}
function rawLocationsToVScodeLocations(string: string) {
	string = string.replace(/ from ([0-9]+):([0-9]+)/g, ':$1:$2');
	string = string.replace(/ at ([0-9]+):([0-9]+)/g, ':$1:$2');
	return string;
}
function exists(inode: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => {
		fs.exists(inode, (value) => {
			resolve(value);
		});
	});
}
function stat(inode: string): Promise<fs.Stats> {
	return new Promise<fs.Stats>((resolve, reject) => {
		fs.stat(inode, (err, value) => {
			if (!err) resolve(value);
		});
	});
}
async function resolveBashShell() : Promise<string> {
	const shell: string = vscode.workspace.getConfiguration('alan-definitions').get<string>('taskShell')
	if (shell && shell !== null && shell !== '') {
		return shell;
	} else if (process.platform === 'win32') {
		if (await exists(wsl)) {
			return wsl_bash;
		} else if (await exists(git_bash_x64)) {
			return git_bash_x64;
		} else if (await exists(git_bash_x32)) {
			return git_bash_x32;
		} else {
			let error = 'Could not locate a bash shell for executing Alan tasks. Please set one in the extension\'s settings.';
			vscode.window.showErrorMessage(error);
			return undefined;
		}
	} else {
		return linux_osx_bash;
	}
}

function stripAnsi(string: string) {
	const re_strip_ansi = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
	return string.replace(re_strip_ansi, '');
}

function executeCommand(shell_command: string, cwd: string, shell: string, output_channel: vscode.OutputChannel, diagnostics_collection?: vscode.DiagnosticCollection) : Promise<void> {
	return new Promise((resolve, reject) => {
		output_channel.clear();

		if (vscode.workspace.getConfiguration('alan-definitions').get<boolean>('showTaskOutput')) {
			output_channel.show(true);
		}

		diagnostics_collection?.clear();

		output_channel.appendLine(`> Running '${shell_command}' in '${cwd}'`);
		const child: proc.ChildProcess|undefined
			= proc.spawn(shell, ['-c', shell_command], { cwd: cwd });

		if (child) {
			child.on('error', err => {
				const error = `Failure executing command '${shell_command}'.`;
				output_channel.appendLine(error);
				reject();
			});

			let output_acc = '';
			child.stdout.on('data', data => {
				let string: string = bashPathsToWinPaths(data.toString(), shell);
				string = stripAnsi(string);
				string = rawLocationsToVScodeLocations(string);

				output_channel.append(string);
				output_acc += string;
			});

			child.stderr.on('data', data => {
				let string: string = bashPathsToWinPaths(data.toString(), shell);
				string = stripAnsi(string);
				string = rawLocationsToVScodeLocations(string);

				output_channel.append(string);
				output_acc += string;
			});

			child.on('close', retc => {
				const diagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [];

				{ // output parser
					let current_diagnostic: vscode.Diagnostic | undefined;
					const lines: String[] = output_acc.split('\n');
					lines.forEach((line) => {
						function getSeverity(severity: string): vscode.DiagnosticSeverity {
							return severity == 'error' ?
								vscode.DiagnosticSeverity.Error : severity === 'warning' ?
									vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information
						}

						const re_range: RegExp = /^((?:\/|[a-zA-Z]:).*\.alan):([0-9]+):([0-9]+) to ([0-9]+):([0-9]+) (error|warning): (.*)/;
						{
							const range_match = line.match(re_range);
							if (range_match) {
								const file = vscode.Uri.file(range_match[1]);
								const line = parseInt(range_match[2], 10);
								const column = parseInt(range_match[3], 10);
								const endLine = parseInt(range_match[4], 10);
								const endColumn = parseInt(range_match[5], 10);
								const severity = range_match[6];
								const message = range_match[7];

								const range = new vscode.Range(line - 1, column - 1, endLine - 1, endColumn - 1);
								current_diagnostic = new vscode.Diagnostic(range, message, getSeverity(severity));
								diagnostics.push([file, [current_diagnostic]]);
								return;
							}
						}

						const re_locat: RegExp = /^((?:\/|[a-zA-Z]:).*\.alan):([0-9]+):([0-9]+) (error|warning): (.*)/;
						{
							const locat_match = line.match(re_locat);
							if (locat_match) {
								const file = vscode.Uri.file(locat_match[1]);
								const line = parseInt(locat_match[2], 10);
								const column = parseInt(locat_match[3], 10);
								const severity = locat_match[4];
								const message = locat_match[5];

								const range = new vscode.Range(line - 1, column - 1, line - 1, column - 1);
								current_diagnostic = new vscode.Diagnostic(range, message, getSeverity(severity));
								diagnostics.push([file, [current_diagnostic]]);
								return;
							}
						}

						const re_link: RegExp = /^((?:\/|[a-zA-Z]:).*\.link) (error|warning): (.*)/;
						{
							const link_match = line.match(re_link);
							if (link_match) {
								const file = vscode.Uri.file(link_match[1]);
								const severity = link_match[2];
								const message = link_match[3];

								const range = new vscode.Range(0, 0, 0, 0);
								current_diagnostic = new vscode.Diagnostic(range, message, getSeverity(severity));
								diagnostics.push([file, [current_diagnostic]]);
								return;
							}
						}

						const re_other: RegExp = /^((?:\/|[a-zA-Z]:).*) (error|warning): (.*)/;
						{
							const other_match = line.match(re_other);
							if (other_match) {
								const file = vscode.Uri.file(other_match[1]);
								const severity = other_match[2];
								const message = other_match[3];

								const range = new vscode.Range(0, 0, 0, 0);
								current_diagnostic = new vscode.Diagnostic(range, message, getSeverity(severity));
								diagnostics.push([file, [current_diagnostic]]);
								return;
							}
						}

						if (current_diagnostic && line.startsWith('\t')) {
							current_diagnostic.message += '\n' + line;
						} else {
							current_diagnostic = undefined;
						}
					});
				}

				diagnostics_collection?.set(diagnostics);

				resolve();
			});
		} else {
			const error = `Unable to execute command '${shell_command}'.`;
			output_channel.appendLine(error);
			reject();
		}
	});
}

async function getMigrationName(shell: string, alan_root: string): Promise<string> {
	return new Promise(resolve => {
		vscode.window.showInputBox({
			value: 'from_empty',
			valueSelection: [5,10],
			placeHolder: `For example: <git commit id of 'from' model>`
		}).then(migration_name_raw => {
			const migration_name = sanitize(migration_name_raw);
			resolve(pathToBashPath(`${alan_root}/migrations/${migration_name}`, shell));
		});
	});
}
async function getMigrationModel(shell: string, alan_root: string): Promise<string> {
	return new Promise(resolve => {
		let models = [];
		let model_path:((model:string) => string);

		if (fs.existsSync(path.join(alan_root, 'models'))) { //platform >= 2021.8
			// NOTE: in order to use models directly, we need to update generate_migration.sh,
			// which relies on model.link files. Use the following code when we can:
			// model_path = (model) => `${alan_root}/.alan/devenv/output/objects/models/${model}/package`;
			// models = fs.readdirSync(path.join(alan_root, 'models'));

			// legacy approach, for now:
			model_path = (model) => `${alan_root}/systems/${model}`;
			models = fs.readdirSync(path.join(alan_root, 'systems'))
				.map(system => path.join(system, 'model.link'))
				.filter(modellib => fs.existsSync(path.join(alan_root, 'systems', modellib)));
		} else {  //platform < 2021.8
			model_path = (model) => `${alan_root}/systems/${model}`;
			models = fs.readdirSync(path.join(alan_root, 'systems'))
				.map(system => path.join(system, 'model.lib.link'))
				.filter(modellib => fs.existsSync(path.join(alan_root, 'systems', modellib)));
		}

		if (models.length <= 0) {
			let error = `Unable to resolve a 'systems/**/model.link' file,`
				+ ` which is required for generating a migration (or a 'model.lib.link'`
				+ ` file for platform version < 2021.8). Make sure that you have a`
				+ ` system to migrate from, and that you have run Alan Build.`
			vscode.window.showErrorMessage(error);
			return;
		}

		vscode.window.showQuickPick(models, {
			placeHolder: 'migration target model'
		}).then(migration_model => {
			const model_file = model_path(migration_model);
			fs.access(model_file, (err) => {
				if (err) {
					vscode.window.showErrorMessage(`Please run Alan Build to compile model '${migration_model}' first.`);
				}
				else {
					resolve(pathToBashPath(model_file, shell));
				}
			});
		});
	});
}
async function getMigrationType(): Promise<string> {
	const migration_type_bootstrap = 'initialization from empty dataset';
	const migration_type = await vscode.window.showQuickPick([
		'mapping from target conformant dataset',
		migration_type_bootstrap
	], {
		placeHolder: 'migration type'
	});

	return migration_type === migration_type_bootstrap ? '--bootstrap' : '';
}
class DeployItem implements vscode.QuickPickItem {
	label: string;
	description?: string;
	detail?: string;

	picked?: boolean;
	alwaysShow?: boolean;

	constructor(label: string, description: string, detail: string) {
		this.label = label;
		this.description = description;
		this.detail = detail;
	}
}
async function getDeployType(): Promise<string | undefined> {
	const deploy_type_empty = new DeployItem('empty', 'Initialize with empty dataset', 'Use this for your first deployment or if you want to start over. This will remove all user data!');
	const deploy_type_migrate = new DeployItem('migrate', 'Migrate from current version', 'This will migrate the data from the running version to your current application version.');
	const deploy_type = await vscode.window.showQuickPick([
		deploy_type_empty,
		deploy_type_migrate
	], {
		placeHolder: 'data source for this deployment'
	});

	return deploy_type === undefined ? undefined : deploy_type.label;
}

export async function generateMigration(working_dir: string, alan_root: string, output_channel: vscode.OutputChannel, diagnostics_collection: vscode.DiagnosticCollection) {
	const shell = await resolveBashShell();
	const alan_root_folder = pathToBashPath(alan_root, shell);

	const name = await getMigrationName(shell, alan_root);
	const model = await getMigrationModel(shell, alan_root);
	const type = await getMigrationType();

	const script_paths = [
		`${alan_root_folder}/.alan/devenv/system-types/datastore/scripts/generate_migration.sh`,
		`${alan_root_folder}/.alan/dataenv/system-types/datastore/scripts/generate_migration.sh`
	];

	for (const script_path of script_paths) {
		if (await exists(script_path)) {
			executeCommand(
				`${script_path} ${name} ${model} ${type}`,
				working_dir,
				shell,
				output_channel,
				diagnostics_collection);
			break;
		}
	}
}

export async function build(working_dir: string, alan_root: string, output_channel: vscode.OutputChannel, diagnostics_collection: vscode.DiagnosticCollection): Promise<void> {
	const shell = await resolveBashShell();
	const alan = pathToBashPath(`${alan_root}/alan`, shell);

	return executeCommand(`${alan} build`, working_dir, shell, output_channel, diagnostics_collection);
}

export async function package_deployment(src: string, output_channel: vscode.OutputChannel, diagnostics_collection: vscode.DiagnosticCollection): Promise<void> {
	const shell = await resolveBashShell();

	const active_file_dirname = path.dirname(src);
	const active_file_dirname_bash = pathToBashPath(active_file_dirname, shell);
	const alan_root = await resolveRoot(active_file_dirname, 'alan');

	return executeCommand(`./alan package ./dist/project.pkg ${active_file_dirname_bash}`, alan_root, shell, output_channel, diagnostics_collection);
}

export async function fetch(alan_root: string, output_channel: vscode.OutputChannel, diagnostics_collection: vscode.DiagnosticCollection): Promise<void> {
	const shell = await resolveBashShell();
	const alan = pathToBashPath(`${alan_root}/alan`, shell);

	return executeCommand(`${alan} fetch`, alan_root, shell, output_channel, diagnostics_collection);
}

export async function bootstrap(alan_root: string, output_channel: vscode.OutputChannel, diagnostics_collection: vscode.DiagnosticCollection): Promise<void> {
	const shell = await resolveBashShell();
	const alan = pathToBashPath(`${alan_root}/bootstrap.sh`, shell);

	return executeCommand(`${alan}`, alan_root, shell, output_channel, diagnostics_collection);
}

export async function deploy(alan_root: string, output_channel: vscode.OutputChannel, diagnostics_collection: vscode.DiagnosticCollection) {
	const shell = await resolveBashShell();
	const deploy_sh = pathToBashPath(`${alan_root}/deploy.sh`, shell);

	const deploy_type = await getDeployType();

	if (deploy_type !== undefined) {
		executeCommand(`${deploy_sh} ${deploy_type}`, alan_root, shell, output_channel, diagnostics_collection);
	}
}

export async function show() {
	vscode.env.openExternal(vscode.Uri.parse(process.env.ALAN_APP_URL));
}

export async function resolveRoot(file_dir: string, root_marker: string) : Promise<string> {
	const {root} = path.parse(file_dir);

	return new Promise((resolve, reject) => {
		(async function find(curdir) {
			const alan_file = path.join(curdir, root_marker);
			if (curdir === root) {
				reject(undefined);
			} else if (await exists(alan_file) && (await stat(alan_file)).isFile()) {
				resolve(curdir);
			} else if (path.dirname(curdir) == curdir) {
				reject(undefined);
			} else {
				find(path.dirname(curdir));
			}
		})(file_dir);
	});
}

export async function getTasksList(alan_root: string, deploy_supported: boolean, show_supported: boolean): Promise<vscode.Task[]> {
	const workspace_root = vscode.workspace.rootPath;
	if (!workspace_root) return [];

	try {
		const shell = await resolveBashShell();

		const result: vscode.Task[] = [];
		const default_options: vscode.ShellExecutionOptions = {
			'executable': shell, //custom or default
			'shellArgs': ['-c']
		};
		const no_problem_matchers = []; // prevent popup to scan task output

		const fetch_task = new vscode.Task({
			'type': 'alan',
			'task': 'fetch'
		}, 'fetch','alan', new vscode.ShellExecution('${command:alan.tasks.fetch}', default_options), no_problem_matchers);
		fetch_task.group = vscode.TaskGroup.Clean; //??

		const build_task = new vscode.Task({
			'type': 'alan',
			'task': 'build'
		}, 'build','alan', new vscode.ShellExecution('${command:alan.tasks.build}', default_options), no_problem_matchers);
		build_task.group = vscode.TaskGroup.Build;

		const migration_task = new vscode.Task({
			'type': 'alan',
			'task': 'generate migration'
		}, 'generate migration', 'alan', new vscode.ShellExecution('${command:alan.tasks.generateMigration}', default_options), no_problem_matchers);
		migration_task.group = vscode.TaskGroup.Clean; //??

		const shell_task = new vscode.Task(
			{
				'type': 'alan',
				'task': 'shell'
			},
			vscode.TaskScope.Workspace,
			'script',
			'alan',
			new vscode.ShellExecution('${task:command}', {}),
			// new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
			// 	let cmd = "";
			// 	return ;
			// 	// return executeCommand(`${cmd}`, alan_root, shell, output_channel, diagnostics_collection);

			// 	// return new CustomBuildTaskTerminal(this.workspaceRoot, flavor, flags, () => this.sharedState, (state: string) => this.sharedState = state);
			// })),
			no_problem_matchers
		);
		fetch_task.group = vscode.TaskGroup.Build;

		result.push(shell_task);
		result.push(fetch_task);
		result.push(build_task);
		result.push(migration_task);

		if (vscode.window.activeTextEditor && deploymentPackagingContexts[path.basename(vscode.window.activeTextEditor.document.uri.fsPath)] !== undefined) {
			const package_task = new vscode.Task({
				'type': 'alan',
				'task': 'package'
			}, 'package', 'alan', new vscode.ShellExecution('${command:alan.tasks.package}', default_options), no_problem_matchers);
			package_task.group = vscode.TaskGroup.Build;
			result.push(package_task);
		}

		if (deploy_supported) {
			const deploy_task = new vscode.Task({
				'type': 'alan',
				'task': 'deploy'
			}, 'deploy', 'alan', new vscode.ShellExecution('${command:alan.tasks.deploy}', default_options), no_problem_matchers);
			deploy_task.group = vscode.TaskGroup.Test;
			result.push(deploy_task);
		}

		if (show_supported) {
			const deploy_task = new vscode.Task({
				'type': 'alan',
				'task': 'show'
			}, 'deploy', 'alan', new vscode.ShellExecution('${command:alan.tasks.show}', default_options), no_problem_matchers);
			deploy_task.group = vscode.TaskGroup.Test;
			result.push(deploy_task);
		}

		return result;
	} catch {
		return [];
	}
}

export async function scriptDev(output_channel: vscode.OutputChannel, diagnostics_collection: vscode.DiagnosticCollection, cmd: string, cwd: string) {
	const shell = await resolveBashShell();
	executeCommand(`${cmd}`, cwd, shell, output_channel, diagnostics_collection);
}
export async function buildDev(output_channel: vscode.OutputChannel, diagnostics_collection: vscode.DiagnosticCollection) {
	const shell = await resolveBashShell();

	const active_file_name = vscode.window.activeTextEditor.document.fileName;
	const active_file_dirname = path.dirname(active_file_name);
	const alan_root = await resolveRoot(active_file_dirname, 'project.json');
	const build_sh = pathToBashPath(`${alan_root}/build.sh`, shell);

	executeCommand(`${build_sh}`, alan_root, shell, output_channel, diagnostics_collection);
}
export async function testDev(output_channel: vscode.OutputChannel, diagnostics_collection: vscode.DiagnosticCollection) {
	const shell = await resolveBashShell();

	const active_file_name = vscode.window.activeTextEditor.document.fileName;
	const active_file_dirname = path.dirname(active_file_name);
	const alan_root = await resolveRoot(active_file_dirname, 'project.json');
	const test_sh = pathToBashPath(`${alan_root}/test.sh`, shell);

	executeCommand(`${test_sh}`, alan_root, shell, output_channel, diagnostics_collection);
}

export async function getTasksListDev(dev_root: string): Promise<vscode.Task[]> {
	const workspace_root = vscode.workspace.rootPath;
	if (!workspace_root) return [];

	try {
		const shell = await resolveBashShell();
		const bootstrap_sh = pathToBashPath(`${dev_root}/bootstrap.sh`, shell);

		const result: vscode.Task[] = [];
		const default_options: vscode.ShellExecutionOptions = {
			'executable': shell, //custom or default
			'cwd': '${fileDirname}',
			'shellArgs': ['-c']
		};
		const no_problem_matchers = []; // prevent popup to scan task output

		const bootstrap_task = new vscode.Task({
			'type': 'alan',
			'task': 'fetch'
		}, 'fetch','alan', new vscode.ShellExecution(`${bootstrap_sh}`, default_options), no_problem_matchers);
		default_options.cwd = dev_root;
		bootstrap_task.group = vscode.TaskGroup.Clean; //??
		bootstrap_task.presentationOptions = {
			'clear': true,
			'reveal': vscode.TaskRevealKind.Always,
			'showReuseMessage': false,
			'focus': false
		};

		const build_task = new vscode.Task({
			'type': 'alan',
			'task': 'build'
		}, 'build','alan', new vscode.ShellExecution('${command:alan.dev.tasks.build}', default_options), no_problem_matchers);
		build_task.group = vscode.TaskGroup.Build;

		const test_task = new vscode.Task({
			'type': 'alan',
			'task': 'test'
		}, 'test', 'alan', new vscode.ShellExecution('${command:alan.dev.tasks.test}', default_options), no_problem_matchers);
		test_task.group = vscode.TaskGroup.Test;

		result.push(bootstrap_task);
		result.push(build_task);
		result.push(test_task);

		return result;
	} catch {
		return [];
	}
}