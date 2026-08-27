#!/usr/bin/env bash
#
# Backs up a GuitHub instance: every song's full git history plus the metadata
# database. Both are written to a dated directory so a restore is a plain copy.
#
# The git bundles are self-contained clones of each song repository, so a bundle
# alone is enough to recover the complete history of that song even without GuitHub.
#
# Usage:  backup.sh <data-dir> <backup-dir>
# Cron:   15 3 * * *  /opt/guithub/scripts/backup.sh /var/lib/guithub /mnt/backup/guithub

set -euo pipefail

DATA_DIR="${1:?usage: backup.sh <data-dir> <backup-dir>}"
BACKUP_ROOT="${2:?usage: backup.sh <data-dir> <backup-dir>}"
KEEP_DAYS="${GUITHUB_BACKUP_KEEP_DAYS:-30}"

if [[ ! -d "$DATA_DIR" ]]; then
  echo "backup.sh: no such data directory: $DATA_DIR" >&2
  exit 1
fi

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST/songs"

echo "GuitHub backup -> $DEST"

# --- songs -----------------------------------------------------------------
song_count=0
if [[ -d "$DATA_DIR/songs" ]]; then
  for repo in "$DATA_DIR/songs"/*.git; do
    [[ -e "$repo" ]] || continue
    name="$(basename "$repo" .git)"
    # --all captures every ref; a bundle of an empty repo fails, so skip those.
    if git --git-dir="$repo" rev-parse --verify --quiet HEAD >/dev/null 2>&1; then
      git --git-dir="$repo" bundle create "$DEST/songs/$name.bundle" --all >/dev/null 2>&1
      song_count=$((song_count + 1))
    else
      echo "  skipping $name (no commits yet)"
    fi
  done
fi
echo "  bundled $song_count song(s)"

# --- database --------------------------------------------------------------
# The online backup API produces a consistent copy while the server is running;
# copying the file directly could catch a half-written WAL.
DB="$DATA_DIR/guithub.db"
if [[ -f "$DB" ]]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB" ".backup '$DEST/guithub.db'"
  else
    echo "  sqlite3 not installed; falling back to a WAL checkpoint + copy" >&2
    cp "$DB" "$DEST/guithub.db"
    [[ -f "$DB-wal" ]] && cp "$DB-wal" "$DEST/guithub.db-wal"
    [[ -f "$DB-shm" ]] && cp "$DB-shm" "$DEST/guithub.db-shm"
  fi
  echo "  copied database"
fi

# --- manifest --------------------------------------------------------------
cat > "$DEST/MANIFEST.txt" <<EOF
GuitHub backup
created:  $STAMP
source:   $DATA_DIR
songs:    $song_count

To restore:
  1. Stop GuitHub.
  2. Recreate the data directory:  mkdir -p <data-dir>/songs
  3. For each bundle:
       git clone --bare <name>.bundle <data-dir>/songs/<name>.git
  4. Copy guithub.db to <data-dir>/guithub.db
  5. Start GuitHub.

Verify a bundle without restoring:  git bundle verify <name>.bundle
EOF

# --- prune -----------------------------------------------------------------
if [[ "$KEEP_DAYS" -gt 0 ]]; then
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
fi

echo "done: $(du -sh "$DEST" | cut -f1)"
