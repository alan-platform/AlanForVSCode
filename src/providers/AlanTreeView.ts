import * as vsc from "vscode";
import * as path from "path";

// based on DotJoshJohnson/vscode-alan
export class AlanTreeViewDataProvider implements vsc.TreeDataProvider<any> {
    private _onDidChangeTreeData: vsc.EventEmitter<any | null> = new vsc.EventEmitter<any | null>();
    private _alanDocument: any;

    constructor(private _context: vsc.ExtensionContext) {
        vsc.window.onDidChangeActiveTextEditor((editor) => {
            this._refreshTree();
        });

        vsc.workspace.onDidChangeTextDocument((e) => {
            this._refreshTree();
        });
    }

    readonly onDidChangeTreeData: vsc.Event<any | null> = this._onDidChangeTreeData.event;

    get activeEditor(): vsc.TextEditor | null {
        return vsc.window.activeTextEditor || null;
    }

    getChildren(element?: any): vsc.ProviderResult<any> {
        if (!this._alanDocument) {
            this._refreshTree();
        }

        if (element) {
            return [].concat(this._getChildAttributeArray(element), this._getChildElementArray(element));
        } else if (this._alanDocument) {
            return this._alanDocument.childNodes;
        } else {
            return [];
        }
    }

    getTreeItem(element: any): vsc.TreeItem {
        let treeItem = new vsc.TreeItem(element.localName);

        if (this._getChildAttributeArray(element).length > 0) {
            treeItem.collapsibleState = vsc.TreeItemCollapsibleState.Collapsed;
        }

        if (this._getChildElementArray(element).length > 0) {
            treeItem.collapsibleState = vsc.TreeItemCollapsibleState.Collapsed;
        }

        treeItem.command = {
            command: "revealLine",
            title: "",
            arguments: [{
                lineNumber: (element as any).lineNumber - 1,
                at: "top"
            }]
        };

        treeItem.iconPath = this._getIcon(element);

        return treeItem;
    }

    private _getChildAttributeArray(node: any): any[] {
        if (!node.attributes) {
            return [];
        }

        let array = new Array<any>();

        for (let i = 0; i < node.attributes.length; i++) {
            array.push(node.attributes[i]);
        }

        return array;
    }

    private _getChildElementArray(node: any): any[] {
        if (!node.childNodes) {
            return [];
        }

        let array = new Array<any>();

        for (let i = 0; i < node.childNodes.length; i++) {
            let child = node.childNodes[i];

            if ((child as any).tagName) {
                array.push(child);
            }
        }

        return array;
    }

    private _getIcon(element: any): any {
        let type = "element";

        if (!(element as any).tagName) {
            type = "attribute";
        }

        let icon = {
            dark: this._context.asAbsolutePath(path.join("resources", "icons", `${type}.dark.svg`)),
            light: this._context.asAbsolutePath(path.join("resources", "icons", `${type}.light.svg`))
        };

        return icon;
    }

    private _refreshTree(): void {
        if (!this.activeEditor || this.activeEditor.document.languageId !== "alan") {
            this._alanDocument = null;
            this._onDidChangeTreeData.fire();
            return;
        }
        const document = this.activeEditor.document;

        var re = /^(\s*)(('[^']*')|([a-z]+[a-z\-\s]+))/;

        function createItem(string, line_index) {
            return {
                "tagName": string,
                "localName": string,
                "nodeType": 1,
                "lineNumber": line_index + 1,
                "childNodes": []
            };
        }

        const root_node = createItem(path.basename(document.fileName), 0);
        let stack = [{ 'item': root_node, 'level': -1 }];

        for (var i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            var matches = line.text.match(re);
            if (matches !== null && matches.length >= 3 && matches[2] !== "") {
                const my_level = matches[1].length;
                while (my_level <= stack[stack.length - 1].level)
                    stack.pop();

                const parent_node = stack[stack.length - 1].item;
                var new_node = createItem(matches[2], i);
                parent_node.childNodes.push(new_node);
                stack.push({ 'item': new_node, 'level': my_level});
            }
        }

        this._alanDocument = root_node;
        this._onDidChangeTreeData.fire();
    }
}
