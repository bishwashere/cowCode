#!/usr/bin/env bash
# Update cowCode in place: download latest code, keep your config, auth, and cron jobs.
# Run from inside your cowCode folder:  cd cowCode && curl -fsSL ... | bash
# Or:  cd cowCode && bash update.sh
set -e

BRANCH="${COWCODE_BRANCH:-main}"
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

# Backup user data (do not overwrite with release)
BACKUP="$WORK/backup"
mkdir -p "$BACKUP"
[ -f "$ROOT/config.json" ]     && cp "$ROOT/config.json"     "$BACKUP/"
[ -f "$ROOT/.env" ]            && cp "$ROOT/.env"            "$BACKUP/"
[ -f "$ROOT/cron/jobs.json" ]  && mkdir -p "$BACKUP/cron" && cp "$ROOT/cron/jobs.json" "$BACKUP/cron/"
[ -d "$ROOT/auth_info" ]       && cp -R "$ROOT/auth_info"   "$BACKUP/"

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

# Restore user data
[ -f "$BACKUP/config.json" ]     && cp "$BACKUP/config.json"     "$ROOT/"
[ -f "$BACKUP/.env" ]            && cp "$BACKUP/.env"            "$ROOT/"
[ -f "$BACKUP/cron/jobs.json" ]  && cp "$BACKUP/cron/jobs.json"  "$ROOT/cron/"
[ -d "$BACKUP/auth_info" ]       && rm -rf "$ROOT/auth_info" && cp -R "$BACKUP/auth_info" "$ROOT/"

echo "  ► Installing dependencies..."
(cd "$ROOT" && npm install)

echo ""
echo "  ✓ Update complete. Start the bot with:  npm start"
echo ""
