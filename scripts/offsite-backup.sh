#!/usr/bin/env bash
#
# Nightly offsite backup.
#
# Runs backup.sh to produce a git bundle per song plus a consistent copy of the
# database, then pushes that to object storage with restic (encrypted, deduplicated,
# with retention). Each bundle is a complete clone: a song can be recovered with
# plain `git clone` even without GuitHub, restic, or this script.
#
# Configuration lives in /etc/guithub/backup.env, readable only by root:
#
#   RESTIC_REPOSITORY=s3:https://<account>.r2.cloudflarestorage.com/guithub-backup
#   RESTIC_PASSWORD=<a long passphrase — without it the backup is unreadable>
#   AWS_ACCESS_KEY_ID=<R2 access key>
#   AWS_SECRET_ACCESS_KEY=<R2 secret key>
#   HEALTHCHECK_URL=https://hc-ping.com/<uuid>     # optional
#
# Usage:  offsite-backup.sh <data-dir>
# Timer:  see the systemd unit in the README.

set -euo pipefail

DATA_DIR="${1:?usage: offsite-backup.sh <data-dir>}"
CONFIG="${GUITHUB_BACKUP_ENV:-/etc/guithub/backup.env}"
# A fixed path, deliberately not mktemp -d. restic groups snapshots by host and
# paths, so a fresh directory every night would put each night in a group of its
# own; `forget` keeps its policy per group, so it would keep one snapshot from
# every group and prune nothing, ever. The repository would grow without bound
# while appearing to have a retention policy — the failure mode you only notice
# when the storage bill or the free tier runs out.
STAGING="${GUITHUB_BACKUP_STAGING:-/var/tmp/guithub-backup-staging}"
rm -rf "$STAGING"
mkdir -p "$STAGING"
trap 'rm -rf "$STAGING"' EXIT

if [[ -f "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$CONFIG"; set +a
fi

: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY in $CONFIG}"
: "${RESTIC_PASSWORD:?set RESTIC_PASSWORD in $CONFIG}"

ping_health() {
  [[ -n "${HEALTHCHECK_URL:-}" ]] || return 0
  curl -fsS --max-time 10 --retry 3 "${HEALTHCHECK_URL}${1:-}" > /dev/null || true
}

# Tell the monitor we started, so a hang is distinguishable from a failure.
ping_health "/start"

fail() {
  echo "offsite-backup: $1" >&2
  ping_health "/fail"
  exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$HERE/backup.sh" "$DATA_DIR" "$STAGING" || fail "backup.sh failed"

# First run needs a repository to exist.
restic snapshots > /dev/null 2>&1 || restic init || fail "could not initialise restic repository"

restic backup --tag guithub --host guithub "$STAGING" || fail "restic backup failed"

# --group-by host,tags rather than the default host,paths: belt and braces with
# the fixed staging path above, so retention stays correct even if the path
# changes again some day.
restic forget --tag guithub \
  --group-by host,tags \
  --keep-daily 14 --keep-weekly 8 --keep-monthly 12 \
  --prune || fail "restic forget/prune failed"

# Cheap integrity check on every run; a full --read-data is too slow nightly.
restic check || fail "restic check failed"

echo "offsite-backup: done — $(restic snapshots --tag guithub --json | grep -c '"time"') snapshot(s) retained"
ping_health
