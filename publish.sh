#!/bin/bash
set -e

# publish to marketplace
./node_modules/.bin/vsce publish -p $VSCE_TOKEN --packagePath *.vsix

# tag commit
TAG_NAME="published/$(jq -j '.version' < package.json)"
git tag "${TAG_NAME}"

# push tag
git remote add origin-tagging https://${GITHUB_TOKEN}@github.com/${TRAVIS_REPO_SLUG}.git
git push origin-tagging "${TAG_NAME}"
