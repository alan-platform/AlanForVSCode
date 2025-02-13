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
import { promiseHooks } from 'v8';


function statusString(state: State): string {
	switch (state) {
		case State.Starting:
			return 'Starting';
		case State.Running:
			return 'Running';
		case State.Stopped:
			return 'Stopped';
	}
}

async function startClient(client: LanguageClient) {
	// vscode.window.showInformationMessage(`Starting Alan Language Server '${client.name}'`);
	return client.start();
}
async function stopClient(client: LanguageClient) {
	// vscode.window.showInformationMessage(`Stopping Alan Language Server '${client.name}'`);
	return client.stop();
}

async function performOperation(client, instr) {
	switch (instr) {
		case 'Start':
		case 'Start All':
			if (client.state != State.Running)
				return startClient(client);
			break;
		case 'Stop':
		case 'Stop All':
			if (client.state != State.Stopped)
				return stopClient(client);
			break;
		case 'Restart':
		case 'Restart All': {
			if (client.state != State.Stopped) {
				await stopClient(client);
			}
			return client.start();
		} break;
	}
};
export async function restartAllLanguageServers(clients: Map<string, LanguageClient>) {
	for (const client of clients.values()) {
		await performOperation(client, 'Restart');
	}
}
async function toggleState(client: LanguageClient) {
	switch (client.state) {
		case State.Starting:
		case State.Running:
			return stopClient(client);
		case State.Stopped:
			return startClient(client);
	}
}

export async function manageLanguageServers(clients: Map<string, LanguageClient>) {
	let last_selection: vscode.QuickPickItem | undefined;
	function manage() {
		const qp: vscode.QuickPick<vscode.QuickPickItem & { client: LanguageClient }> = vscode.window.createQuickPick();
		qp.items = Array.from(clients.values()).map(c => {
			const item = {
				label: c.name,
				detail: statusString(c.state),
				client: c,
				buttons: [
					{
						iconPath: new vscode.ThemeIcon('debug-start'),
						tooltip: 'Start'
					},
					{
						iconPath: new vscode.ThemeIcon('debug-stop'),
						tooltip: 'Stop'
					},
					{
						iconPath: new vscode.ThemeIcon('debug-restart'),
						tooltip: 'Restart'
					},
				]
			};
			return item;
		});
		if (last_selection)
			qp.activeItems = qp.items.filter(i => i.label === last_selection.label);

		qp.placeholder = `Language Server (press 'Enter' to toggle the state for the selected item)`;

		/* buttons for all clients */
		qp.buttons = [
			{
				iconPath: new vscode.ThemeIcon('debug-start'),
				tooltip: 'Start All'
			},
			{
				iconPath: new vscode.ThemeIcon('debug-stop'),
				tooltip: 'Stop All'
			},
			{
				iconPath: new vscode.ThemeIcon('debug-restart'),
				tooltip: 'Restart All'
			}
		];

		const disposables: vscode.Disposable[] = [];
		disposables.push(
			qp.onDidTriggerItemButton(async (o) => {
				const client: LanguageClient = o.item.client;
				await performOperation(client, o.button.tooltip);
				qp.hide();
				manageLanguageServers(clients);
			}),
			qp.onDidTriggerButton(async (o) => {
				await Promise.all(qp.items.map(async (item) => {
					const client: LanguageClient = item.client;
					return performOperation(client, o.tooltip);
				}));
				qp.hide();
				manage();
			}),
			qp.onDidChangeActive(async (items) => {
				if (items.length > 0) {
					last_selection = items[0];
					console.log(last_selection.label)
				}
			}),
			qp.onDidAccept(async () => {
				/* toggle state */
				const item = qp.selectedItems[0];
				if (item && item.client) {
					await toggleState(item.client);
					qp.hide();
					manage();
				}
			}),
			qp.onDidHide(() => {
				qp.dispose();
				disposables.forEach(d => d.dispose());
			})
		);

		qp.show();
	}
	manage();
}