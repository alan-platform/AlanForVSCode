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
        }

        else if (this._alanDocument) {
            return [this._alanDocument];
        }

        else {
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

        let alan = this.activeEditor.document.getText();

        var splitted_file = alan.split("\n");
        var re = /^(\s*)(('[^']*')|([a-z]+[a-z\-\s]+))/;

        function createItem(string, line_index, parent, level) {
            return {
                "tagName": string,
                "localName": string,
                "nodeType": 1,
                "lineNumber": line_index + 1,
                "childNodes": [],
                "parent": parent,
                "level": level
            };
        }

        function getParent(cur_node, my_level) {
            while (my_level < cur_node.level) {
                cur_node = cur_node.parent;
            }
            if (my_level === cur_node.level) {
                return cur_node.parent;
            }
            return cur_node;
        }

        var res = createItem(path.basename(this.activeEditor.document.fileName), 0, null, -1);
        var current_node = null;
        var matches = [];
        splitted_file.forEach((x, i) => {
            var curr = x.match(re);
            if (curr !== null && curr.length >= 3 && curr[2] !== "") {
                current_node = getParent(current_node, curr[1].length);
                var new_node = createItem(curr[2], i, current_node, curr[1].length);
                current_node.childNodes.push(new_node);
                current_node = new_node;
            }
        });

        this._alanDocument = res;

        this._onDidChangeTreeData.fire();
    }
}
