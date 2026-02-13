#!/usr/bin/env bash
set -e
BRANCH="${COWCODE_BRANCH:-master}"
TARBALL="https://github.com/bishwashere/cowCode/archive/refs/heads/${BRANCH}.tar.gz"
EXTRACTED="cowCode-${BRANCH}"
DIR="cowCode"

if [ -d "$DIR" ]; then
  echo "Directory $DIR already exists. Remove it or use another directory."
  exit 1
fi

echo "Downloading cowCode..."
curl -fsSL "$TARBALL" | tar xz
mv "$EXTRACTED" "$DIR"
cd "$DIR"

if [ -t 0 ]; then
  echo "Running setup..."
  node setup.js
else
  echo ""
  echo "Download complete. Setup needs an interactive terminal."
  echo "Run:  cd $DIR && node setup.js"
  echo ""
  echo "Or install deps only: cd $DIR && npm install && npm start"
fi

echo ""
echo "To start the bot later: cd $DIR && npm start"
