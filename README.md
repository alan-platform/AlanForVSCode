# Alan extension for VS Code

Provides support for development on the [Alan platform](https://alan-platform.com/), powered by the Alan language server.

## Features
- syntax highlighting
- code completion
- goto/peek definition, implementation
- find all references, symbol renaming, symbol navigation, outline view
- types and documentation links on hover
- various commands and tasks for building, packaging, and deploying an Alan application
- ... and more

![Screenshot of the Alan extension for Visual Studio Code](./screenshot.png)

## Tasks

The build and fetch tasks can be started from within a `.alan` file.
The extension resolves the nearest `alan` script for the current file, so you can work on multiple projects in a single workspace.

Running the package task requires opening the `deployment.alan` file of the deployment that you want to package.
