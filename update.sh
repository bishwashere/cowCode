#!/usr/bin/env bash
# Update cowCode in place: download latest code, keep your config, auth, and cron jobs.
# Run from inside your cowCode folder:  cd cowCode && curl -fsSL ... | bash
# Or:  cd cowCode && bash update.sh
set -e

BRANCH="${COWCODE_BRANCH:-master}"
TARBALL="https://github.com/bishwashere/cowCode/archive/refs/heads/${BRANCH}.tar.gz"
EXTRACTED="cowCode-${BRANCH}"

# Run from project root (where package.json and index.js exist)
ROOT="${COWCODE_ROOT:-$PWD}"
if [ ! -f "$ROOT/package.json" ] || [ ! -f "$ROOT/index.js" ]; then
  echo ""
  echo "  Run this from inside your cowCode folder:"
  echo "    cd cowCode && curl -fsSL https://raw.githubusercontent.com/bishwashere/cowCode/${BRANCH}/update.sh | bash"
  echo ""
  exit 1
fi

echo ""
echo "  cowCode — Updating..."
echo "  ------------------------------------------------"
echo ""

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# State dir: config/auth/cron live here (new installs and after migration)
STATE_DIR="${COWCODE_STATE_DIR:-$HOME/.cowcode}"
mkdir -p "$STATE_DIR" "$STATE_DIR/cron" "$STATE_DIR/auth_info"

# One-time migration: if state dir has no config but ROOT has data, copy to state dir
if [ ! -f "$STATE_DIR/config.json" ] && [ -f "$ROOT/config.json" ]; then
  echo "  ► Migrating config to $STATE_DIR"
  cp "$ROOT/config.json" "$STATE_DIR/"
  [ -f "$ROOT/.env" ]            && cp "$ROOT/.env" "$STATE_DIR/"
  [ -f "$ROOT/cron/jobs.json" ]  && cp "$ROOT/cron/jobs.json" "$STATE_DIR/cron/"
  [ -d "$ROOT/auth_info" ]       && rm -rf "$STATE_DIR/auth_info" && cp -R "$ROOT/auth_info" "$STATE_DIR/"
fi

echo "  ► Downloading latest..."
curl -fsSL "$TARBALL" -o "$WORK/archive.tar.gz"
tar xzf "$WORK/archive.tar.gz" -C "$WORK"
SRC="$WORK/$EXTRACTED"

echo "  ► Updating files..."
# Copy all from release over current (excluding node_modules)
for f in "$SRC"/*; do
  [ -e "$f" ] || continue
  name=$(basename "$f")
  [ "$name" = "node_modules" ] && continue
  rm -rf "$ROOT/$name"
  cp -R "$f" "$ROOT/"
done

echo "  ► Installing dependencies..."
(cd "$ROOT" && npm install)

echo ""
echo "  ✓ Update complete. Start the bot with:  cowcode moo start"
echo ""
