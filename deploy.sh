#!/bin/bash

# stop on error
set -e

# publish to marketplace
./node_modules/.bin/vsce publish -p $VSCE_TOKEN --packagePath *.vsix

# tag commit
git tag "${TRAVIS_TAG}"

# push tag
git remote add origin-tagging https://${GITHUB_TOKEN}@github.com/${TRAVIS_REPO_SLUG}.git
git push origin-tagging "${TRAVIS_TAG}"
