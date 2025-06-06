# Change Log

## 1.0.11
- fix error messages about the language client not running

## 1.0.10
- restart language client(s) and server(s) on fetch

## 1.0.9
- drop support for old `connections.alan` files
- fix context for package command when `deployment.alan` is not opened
- do not generate a migration when the migration generation wizard is aborted
- list deployment type 'migrate' first
- name for LS diagnostics and output
- start a language server per `build.alan` file (not per `project.json` file)
- fallback to legacy mode when language server initialization fails
- commands to manage and restart language servers

## 1.0.8
- show identifier completions in addition to language server suggestions

## 1.0.7
- use a single task provider for meta and fabric projects

## 1.0.6
- drop `alan-script`
- code cleanup

## 1.0.5
- synchronous initialization
- separate tasks for alan meta from alan fabric

## 1.0.4
- fix language server support for Windows

## 1.0.3
- fix highlighting of keyword `action`

## 1.0.2
- language server support for nested Alan project directories: the extension starts a language server instance for each `versions.json` and `project.json` that is found
- only show (applicable) snippets in `application.alan` and `interface.alan` files
- snippets change: exclude `: `
- auto fetch: run `./alan fetch` or `./bootstrap.sh` when required dependencies are missing
- auto fetch: configuration options to enable/disable it
- list 'mapping from target conformant dataset' as first migration generation option
- fixes for running tasks/commands with no open files in an Alan meta environment

## 1.0.1
- language server support for Windows

## 1.0.0
- implement support for the Alan language server
  - `alan`: build tool/language server for Alan meta projects
  - `fabric`: build tool/language server for Alan platform projects
  - `alan-capture`: path to store language server logs for debugging purposes
- improve fuzzy definition search

## 0.4.22
- find `generate_migration.sh` script depending on platform version

## 0.4.21
- improve snippets

## 0.4.20
- show `Alan Show` button when `ALAN_APP_URL` is set
- show `Alan Deploy` button when `ALAN_CONTAINER_NAME` is set

## 0.4.19
- support Alan platform versions >= 2021.8

## 0.4.18
- update TextMate grammar for new platform version

## 0.4.17
- support running 'Alan: Build' and 'Alan: Generate Migration' when no alan file is active
- add single quoted string (identifier) completions
- proper word ranges for highlighting qouted strings
- fix matching word in definition search
- convert links in output to hyperlinks with line/column
- whitespace trimming enabled by default
- missing keywords added

## 0.4.16
- choose data source during deployment (only for online Alan IDE)

## 0.4.12
- use tab indentation for `.alan` files
- enable tab stops by default for `.alan` files
- indentation rules for automatic indentation on move/paste
- snippets for `application.alan` files

## 0.4.11
- Drop dependency on nak for definition search

## 0.4.10
- Fix definition search

## 0.4.9
- Add symbol provider for outline view and for finding symbols
- Drop Alan Tree View in favor of outline view

## 0.4.6
- Added `Alan Fetch`, `Alan Build`, and `Alan Deploy` button

## 0.4.4
- Improved problem matching
- Multiline warning and error messages
- `Fetch`, `Build`, and `Package` tasks are now available as commands in the command palette when editing a `.alan` file
- Right-click on a `.alan` file in the explorer shows applicable commands
  - For any `.alan` file: `Alan: Fetch` and `Alan: Build`
  - For `connections.alan` files: `Alan: Package Deployment`
- Added user settings option for showing task output on task execution

## 0.3.9
- Add task for generating migrations

## 0.3.0
- Add task definitions

## 0.2.4
- Improved tree widget
- Better example validation task

## 0.2.3
- Support new Alan model syntax
- New tasks.json template
- Contribute problem matcher

## 0.1.2
- Fix missing node_modules in CI builds

## 0.1.1
- Alan tree view

## 0.0.1
- Initial release
