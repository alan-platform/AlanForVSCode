# Fabric language package for VS Code

To enable this extension, put the `fabric-vscode-syntax` folder in your extensions folder `.vscode/extensions`. Depending on your platform it is located in the following folders:

- Windows `%USERPROFILE%\.vscode\extensions`
- Mac `~/.vscode/extensions`
- Linux `~/.vscode/extensions`

## Example task configuration

Tasks are configured per project. Create a `.vscode` folder in the project root and add a `tasks.json` file. 

This is an example with a problemMatcher compatible with the `--f-sublime` output of the alan project compiler.

```json
{
    "version": "0.1.0",
    "isShellCommand": true,
    "showOutput": "always",
    "tasks": [
        {
            "taskName": "Widgets",
            "command": "bash",
            "args": [
                "-c",
                "grunt shell:controls shell:widgets --no-color"
            ],
            "isShellCommand": true,
            "showOutput": "always",
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
        },
        {
            "taskName": "Fast",
            "command": "bash",
            "args": [
                "-c",
                "grunt build compile package --no-color"
            ],
            "isShellCommand": true,
            "showOutput": "always",
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
        },
        {
            "taskName": "Language",
            "command": "./dev/scripts/create-engine-version.sh",
            "args": [ ],
            "isShellCommand": true,
            "showOutput": "always",
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
