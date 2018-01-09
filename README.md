# Alan extension for VS Code

This package provides syntax highlighting and goto/peek definition for Alan languages, and other tools for working with Alan projects.

## Build task

The `alan validate` command can be run via a task to highlight errors in your alan file. Tasks are configured per project. Create a `.vscode` folder in the project root and add a `tasks.json` file with the following content:

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Alan Validate",
            "type": "shell",
            "group": "build",
            "command": "bash -c 'pushd ${fileDirname} && alan validate vscode --wire && popd'",
            "presentation": {
                "reveal": "always",
                "panel": "new"
            },
            "problemMatcher": {
                "owner": "alan",
                "fileLocation": ["absolute"],
                "pattern": {
                    "regexp": "(^.*alan):([0-9]+):([0-9]+):(error|warning): (.*)",
                    "file": 1,
                    "line": 2,
                    "column": 3,
                    "severity": 4,
                    "message": 5
                }
            }
        }
    ]
}
```
