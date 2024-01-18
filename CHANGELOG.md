# Change Log

## 1.0
- implement support for the Alan language server
  - `alan`: build tool/language server for Alan meta projects
  - `fabric`: build tool/language server for Alan platform projects
  - `alan-capture`: path to store language server logs for debugging purposes
- add task type `alan-script`
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
