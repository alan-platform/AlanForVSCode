'use strict';

/*
	The MIT License (MIT)

	Copyright (c) 2016 Johannes Rieken

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in
	all copies or substantial portions of the Software.
*/

import * as vscode from 'vscode';
import {extname} from 'path';
import * as nak from 'nak';
import { Stream } from 'stream';

export function showDefinitions(editor: vscode.TextEditor): Promise<void | vscode.Location[]> {
	let {document, selection} = editor;

	//Fuzzy Definition Search based on Fuzzy Definitions from Johannes Rieken
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
}
export function fuzzyDefinitionSearch(document: vscode.TextDocument, pos: vscode.Position, token: vscode.CancellationToken) {
	if (document.getWordRangeAtPosition(pos)) {
		return Promise.all([
			delegatingDefinitionSearch(document, pos, token),
			nakDefinitionSearch(document, pos, token)
		]).then(values => {
			let [first, second] = values;
			let all = first.concat(second);
			dedup(all);
			return all;
		});
	}
}

function openLocation(location: vscode.Location) {
	return vscode.workspace.openTextDocument(location.uri).then(doc => {
		return vscode.window.showTextDocument(doc).then(editor => {
			editor.revealRange(location.range);
		});
	});
}

function dedup(locations: vscode.Location[]){
	locations.sort((a, b) => {
		if (a.uri.toString() < b.uri.toString()) {
			return -1;
		} else if (a.uri.toString() > b.uri.toString()) {
			return 1;
		} else {
			return a.range.start.compareTo(b.range.start);
		}
	});

	let last = locations[0];
	for (let i = 1; i < locations.length; i++){
		let loc = locations[i];

		if (loc.uri.toString() === last.uri.toString()
			&& loc.range.intersection(last.range)) {

			locations.splice(i, 1);
			i--;

		} else {
			last = loc;
		}
	}
}

function delegatingDefinitionSearch(document: vscode.TextDocument, pos: vscode.Position, token: vscode.CancellationToken): PromiseLike<vscode.Location[]> {
	let range = document.getWordRangeAtPosition(pos);
	let word = document.getText(range);

	return vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', word).then(symbols => {
		let result: vscode.Location[] = [];
		for (let symbol of symbols) {
			let {location} = symbol;
			if (extname(location.uri.fsPath) === extname(document.fileName)) {
				result.push(location);
			}
		}
		return result;
	});
}

function nakDefinitionSearch(document: vscode.TextDocument, pos: vscode.Position, token: vscode.CancellationToken): PromiseLike<vscode.Location[]> {
	return new Promise<vscode.Location[]>((resolve, reject) => {
		let tmpword = document.getText(new vscode.Range(new vscode.Position(pos.line, 0), pos));

		let charpos = pos.character;
		while (charpos >= 0 && tmpword[charpos] != '\'') {
			charpos--;
		}

		if (charpos < 0) {
			return reject("No definition for this.");
		}

		let range = document.getWordRangeAtPosition(new vscode.Position(pos.line, charpos), /'[^']+'/);
		let word = document.getText(range);

		if (word.length > 300) {
			return reject("No definition for this.");
		}

		let pattern = `\t${word}`;
		let result: vscode.Location[] = [];
		global['callback'] = (_, streamer: {stream: Stream}) => { //Hmm...
			streamer.stream.on('data', (data: string) => {
				let matches = data.split('\n');
				matches.pop(); // pop ""
				let lastUri: vscode.Uri = vscode.Uri.file(matches[0].substr(1));
				for (let imatch = 1; imatch < matches.length; ++imatch) {
					let lastMatch: RegExpMatchArray = /^(\d+);\d+ (\d+)/.exec(matches[imatch]);
					let line = parseInt(lastMatch[1]) - 1;
					let end = parseInt(lastMatch[2]);
					range = new vscode.Range(line, end - word.length + 1, line, end);

					if (lastUri.toString() !== document.uri.toString() || !range.contains(pos)) {
						result.push(new vscode.Location(lastUri, range));
					}
				}
			});
			streamer.stream.on('end', () => {
				resolve(result);
			});
		};

		// wait no longer then 60sec for nak
		setTimeout(() => {
			resolve([]);
			nak.kill();
		}, 60000);
		token.onCancellationRequested(() => nak.kill());

		nak.run({
			ackmate: true,
			pathInclude: `*${extname(document.fileName)}`,
			query: pattern,
			path: vscode.workspace.rootPath
		});
	});
}
