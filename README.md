# Alan extension for VS Code

In addition to syntax highlighting, this package provides naive support for goto/peek definition in Alan files, as well as a file structure tree.

## Build task

Run the build system and highlight errors in your project. 

To create tasks, run Configure Task from the command pallette (select Other if you don't have tasks configured yet). In the tasks.json add the example validation task. Note that this assumes the default PowerShell as your main shell, and using bash from GitForWindows.

```json
{
	"version": "2.0.0",
	"tasks": [
		{
			"label": "Alan Validate",
			"type": "shell",
			"options": {
				"cwd": "${fileDirname}"
			},
			"windows": {
				"command": "& 'C:\\Program Files\\Git\\bin\\bash.exe' ${workspaceFolder}/alan build --format vscode"
			},
			"command": "${workspaceFolder}/alan build --format vscode",
			"problemMatcher": "$alanc",
			"presentation": {
				"echo": true,
				"reveal": "silent",
				"focus": false,
				"panel": "shared"
			}
		}
	]
}
```
