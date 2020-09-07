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
import * as fs from 'fs';
import * as path from 'path';

const word_pattern: RegExp = /'[^']+'/;

export function showDefinitions(editor: vscode.TextEditor): Promise<void | vscode.Location[]> {
	let {document, selection} = editor;

	//Fuzzy Definition Search based on Fuzzy Definitions from Johannes Rieken
	return fuzzyDefinitionSearch(document, selection.active, new vscode.CancellationTokenSource().token).then(locations => {
		if (!locations || locations.length === 0) {
			let range = document.getWordRangeAtPosition(selection.active, word_pattern);
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
	if (document.getWordRangeAtPosition(pos, word_pattern)) {
		return Promise.all([
			delegatingDefinitionSearch(document, pos, token),
			alanDefinitionSearch(document, pos, token)
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
	let range = document.getWordRangeAtPosition(pos, word_pattern);
	let word = document.getText(range);

	return vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', word).then(symbols => {
		let result: vscode.Location[] = [];
		for (let symbol of symbols) {
			let {location} = symbol;
			if (path.extname(location.uri.fsPath) === path.extname(document.fileName)) {
				result.push(location);
			}
		}
		return result;
	});
}

function findFiles(base: string, ext: string, files: (string[]|undefined), result: (string[]|undefined)) {
	files = files || fs.readdirSync(base);
    result = result || [];

    files.forEach(file => {
		try {
			var new_base = path.join(base, file);
			if (fs.statSync(new_base).isDirectory()) {
				result = findFiles(new_base, ext, fs.readdirSync(new_base), result);
			} else {
				if (file.substr(-1 * ext.length) === ext) {
					result.push(new_base);
				}
			}
		} catch {
			//ignore
		}
	});
    return result
}

function findInFile(file: string, text: string, on_result: (iline: number, icharacter: number) => void) {
	let lines = fs.readFileSync(file).toString().split("\n");
	lines.forEach((line: string, iline: number) => {
		const character = line.indexOf(text);
		if (character !== -1) {
			on_result(iline, character);
		}
	});
}

function alanDefinitionSearch(document: vscode.TextDocument, pos: vscode.Position, token: vscode.CancellationToken): PromiseLike<vscode.Location[]> {
	return new Promise<vscode.Location[]>((resolve, reject) => {
		let range = document.getWordRangeAtPosition(pos, word_pattern);
		let word = document.getText(range);

		if (word.length > 300) {
			return reject(`No definition found for {word}.`);
		}
		const pattern = `\t${word}`;
		const result: vscode.Location[] = [];

		const files: string[] = findFiles(vscode.workspace.rootPath, path.extname(document.fileName), undefined, undefined);
		files.forEach((file) => {
			let lastUri: vscode.Uri = vscode.Uri.file(file);
			findInFile(file, pattern, (line, character) => {
				range = new vscode.Range(line, character + 1, line, character + word.length + 1);
				if (lastUri.toString() !== document.uri.toString() || !range.contains(pos)) {
					result.push(new vscode.Location(lastUri, range));
				}
			});
		});
		resolve(result);
	});
}
