# Alan extension for VS Code

This package provides syntax highlighting and goto/peek definition for Alan languages, and other tools for working with Alan projects.

## Build task

The `alan validate` command can be run via a task to highlight errors in your alan file. Tasks are configured per project. Create a `.vscode` folder in the project root and add a `tasks.json` file with the following content:

```json
{
    "version": "2.0.0",
    "windows": {
        "options": {
            "shell": {
                "executable": "C:\\Windows\\System32\\wsl.exe" // VSCode 64 bit
                // "executable": "C:\\Windows\\sysnative\\bash.exe" // VSCode 32 bit
            }
        }
    },
    "tasks": [
        {
            "label": "Alan validate",
            "type": "shell",
            "options": {
                "cwd": "${fileDirname}"
            },
            "windows": {
                "command": "bash -ci \"alan validate vscode --wire 2>&1 | sed -e 's@^/mnt/\\([a-z]\\)@\\1:@g'\""
            },
            "command": "alan validate vscode --wire",
            "problemMatcher": "$alanc",
            "group": {
                "kind": "build",
                "isDefault": true
            },
            "presentation": {
                "echo": true,
                "reveal": "silent",
                "focus": false,
                "panel": "shared"
            }
        },
        {
            "label": "Alan validate - no wiring",
            "type": "shell",
            "options": {
                "cwd": "${fileDirname}"
            },
            "windows": {
                "command": "bash -ci \"alan validate vscode 2>&1 | sed -e 's@^/mnt/\\([a-z]\\)@\\1:@g'\""
            },
            "command": "alan validate vscode",
            "problemMatcher": "$alanc",
            "presentation": {
                "echo": true,
                "reveal": "silent",
                "focus": false,
                "panel": "shared"
            }
        },
        {
            "label": "Alan build all",
            "type": "shell",
            "options": {
                "cwd": "${workspaceFolder}"
            },
            "windows": {
                "command": "bash -ci \"alan build vscode 2>&1 | sed -e 's@^/mnt/\\([a-z]\\)@\\1:@g'\""
            },
            "command": "alan build vscode",
            "problemMatcher": "$alanc",
            "presentation": {
                "echo": true,
                "reveal": "silent",
                "focus": false,
                "panel": "shared"
            }
        },
        {
            "label": "Alan fetch",
            "type": "shell",
            "windows": {
                "command": "bash -ci \"alan fetch\""
            },
            "options": {
                "cwd": "${workspaceFolder}"
            },
            "command": "alan fetch",
            "presentation": {
                "echo": true,
                "reveal": "always",
                "focus": true,
                "panel": "shared"
            }
        }
    ]
}
```
