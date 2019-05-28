import * as vscode from 'vscode';

type AlanDocumentSymbol = (vscode.DocumentSymbol & {parent?: vscode.DocumentSymbol, level?: number});

export class AlanSymbolProvider implements vscode.DocumentSymbolProvider {
	private __createSymbol(name: string, detail: string, kind: vscode.SymbolKind, line: vscode.TextLine, offset: number, parent: AlanDocumentSymbol, symbols: AlanDocumentSymbol[]): AlanDocumentSymbol {
		let new_symbol: AlanDocumentSymbol = new vscode.DocumentSymbol(
			name,
			detail,
			kind,
			new vscode.Range(line.range.start.line, 0, line.range.end.line, line.range.end.character),
			new vscode.Range(line.range.start.line, offset, line.range.start.line, offset + name.length)
		);
		new_symbol.parent = parent;
		new_symbol.level = offset;

		if (parent) {
			parent.children.push(new_symbol);
		} else {
			symbols.push(new_symbol);
		}
		return new_symbol;
	}

	private provideLineSymbols(document: vscode.TextDocument, lbegin: number, lend: number): AlanDocumentSymbol[] {
		const symbols: AlanDocumentSymbol[] = [];
		var re = /^(\s*)((?:'[^']*')|(?:[a-z]+[a-z\-\_\s]+))(.*)/;
		let parent = undefined;
		let line: vscode.TextLine;
		for (var i = lbegin; i <= lend; i++) {
			line = document.lineAt(i);
			var matches = line.text.match(re);
			if (matches !== null && matches.length >= 3 && matches[2] !== "") {
				const my_level = matches[1].length;
				while (parent && parent.level >= my_level) {
					parent.range = new vscode.Range(parent.range.start.line, parent.range.start.character, line.range.start.line, line.range.start.character);
					parent = parent.parent;
				}
				const name_len = matches[2].length;
				let name: string;
				let kind: vscode.SymbolKind;
				let detail: string = '';
				if (name_len > 2 && matches[2][0] === "'") {
					name = matches[2].slice(1, matches[2].length - 1);
					kind = vscode.SymbolKind.Module;

					const re_types = /^\s*(?:\:|->|:=)?\s+(command|with|collection|stategroup|group|text|integer|natural|file|reference-set|number|reference|matrix|densematrix|sparsematrix)/;
					if (matches.length > 3 && matches[3]) {
						const res_types = matches[3].match(re_types);
						if (res_types && res_types[1]) {
							detail = res_types[1];
							switch (res_types[1]) {
								case 'command':
									kind = vscode.SymbolKind.Method;
									break;
								case 'collection':
									kind = vscode.SymbolKind.Array;
									break;
								case 'stategroup':
									kind = vscode.SymbolKind.Enum;
									break;
								case 'group':
									kind = vscode.SymbolKind.Namespace;
									break;
								case 'text':
									kind = vscode.SymbolKind.String;
									break;
								case 'integer':
									kind = vscode.SymbolKind.Number;
									break;
								case 'natural':
									kind = vscode.SymbolKind.Number;
									break;
								case 'file':
									kind = vscode.SymbolKind.File;
									break;
								case 'reference-set':
									kind = vscode.SymbolKind.TypeParameter;
									break;
								case 'with':
									kind = vscode.SymbolKind.Event;
									break;
							}
						} else {
							kind = vscode.SymbolKind.EnumMember; //TODO: fix.
						}
					}
				} else {
					name = matches[2].trim();
					kind = vscode.SymbolKind.Struct;
				}
				parent = this.__createSymbol(name, detail, kind, line, my_level, parent, symbols);
			}
		}
		while (parent) {
			parent.range = new vscode.Range(parent.range.start.line, parent.range.start.character, line.range.end.line, line.range.end.character);
			parent = parent.parent;
		}
		return symbols;
	}

	public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[]> {
		const $this = this;
		return new Promise(async (resolve) => {
			resolve($this.provideLineSymbols(document, 0, document.lineCount - 1));
		});
	}
}
