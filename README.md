# GuitHub

Version control, diff and blame for guitar tablature. Upload Guitar Pro files, see
exactly what changed between versions, find out who wrote which bar, and get any
earlier version back as the original file.

No CLI and no audio playback — a website the band signs into.

## What it does

- **Display** — renders tablature and standard notation in the browser.
- **History** — every version of every song, with who uploaded it and why.
- **Diff** — compare any two versions. Changed bars are highlighted on the rendered
  score, with a note-level list: *"Bar 12, beat 1: string 5, fret 7 → 9"*.
- **Blame** — every bar coloured by the person who last changed it, or by age.
- **Download** — any version, byte-for-byte identical to the file that was uploaded.
- **Invite-only** — no public sign-up; admins send single-use links and the invitee
  picks their own password.
- **Light and dark** — the score is engraved in the theme's colours rather than being
  a white sheet pasted into a dark page. The toggle sits in the top bar and the choice
  is remembered; a first visit follows the operating system's preference.

## How it works

Guitar Pro files are binary, so git cannot diff them usefully. GuitHub parses each
upload and writes a deterministic text projection alongside the original, with
**exactly one line per bar**:

```
tracks/01-guitar-1.tab
  v0: 8[6/3] 8[6/5] 8[5/3h] 8[5/5]
  v0: 4[5/7] 4[5/5] 8[6/3] 8[6/5] 8[5/3] 8[5/5]
```

`6/3` is the 6th string, 3rd fret; `h` is a hammer-on; `8` is an eighth note. Because
each bar is one line, `git diff` gives bar-level change detection and `git blame`
gives per-bar authorship — for free, from git itself, including move detection.

Two details make this work well:

- **Bar lines carry no bar number.** The line's position in the file *is* its bar
  number. Numbering the lines would make inserting one bar rewrite every line after
  it, destroying blame.
- **Song structure lives in its own file.** Tempo, time signature, key, sections and
  repeats go in `structure.tab`, not in the track files, so changing the tempo never
  reassigns credit for anybody's notes.

The original file is always the source of truth. The text projection is derived, and
is only ever used for diffing and blame.

### Storage layout

One bare git repository per song:

```
<data-dir>/songs/<song-id>.git
  song.json           metadata: title, tempo, track list, tunings
  version.json        provenance for this version: original filename, sha256, time
  structure.tab       one line per bar: time signature, tempo, key, sections, repeats
  original.gp5        the exact bytes that were uploaded
  tracks/01-guitar-1.tab
  tracks/02-bass.tab
```

Versions are written with git plumbing — there is no working tree on the server, and
concurrent uploads compare-and-swap the branch tip, so one can never silently discard
another.

## Supported formats

Reading (via [alphaTab](https://github.com/CoderLine/alphaTab), MPL-2.0): Guitar Pro
3–5 (`.gp3`, `.gp4`, `.gp5`), Guitar Pro 6 (`.gpx`), Guitar Pro 7/8 (`.gp`),
MusicXML (`.xml`, `.musicxml`, `.mxl`) and Capella (`.cap`, `.capx`).

Since the original file is stored untouched, downloads always open in Guitar Pro
exactly as they were saved.

## Requirements

- Node.js 20 or newer (22 LTS recommended)
- git (used as the storage engine)
- A C toolchain, for `better-sqlite3` (`build-essential` on Debian/Ubuntu)

## Running it

```bash
npm install
npm run build
GUITHUB_DATA_DIR=./data npm start
```

Then create the first account — deliberately not possible over HTTP — and open
<http://127.0.0.1:8080>:

```bash
GUITHUB_DATA_DIR=./data npm run create-admin -- \
  --username you --name "Your Name" --email you@example.com
```

Everyone else joins by invite link from the **Members** page. There is no public sign-up.

If `node --version` reports something older than 20, the server says so and stops
rather than failing further in. Note that a version manager like nvm only applies to
shells that read your profile, so `/usr/bin/node` and systemd may still see an older
one.

### Scripts

| Command | What it does |
|---|---|
| `npm run build` | Builds core, then server, then the web UI, in that order |
| `npm test` | Runs every test. Needs no build — see below |
| `npm run typecheck` | Typechecks all three packages without emitting |
| `npm start` | Runs the built server |
| `npm run create-admin` | Creates the first administrator (needs a shell on the server) |
| `npm run clean` | Removes all build output |

### Development

```bash
npm run build -w @guithub/core     # the running server and the UI build need this
npm start                          # API on :8080
npm run dev -w @guithub/web        # UI on :5173, proxying /api to :8080
```

The test suite resolves `@guithub/core` to its TypeScript source rather than its
build output, so `npm test` works on a fresh clone with nothing built and never runs
against a stale `dist`. The published entry point is covered by `npm run build`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `GUITHUB_DATA_DIR` | `./data` | Song repositories and the SQLite database |
| `GUITHUB_HOST` | `127.0.0.1` | Bind address |
| `GUITHUB_PORT` | `8080` | Port |
| `GUITHUB_SECURE_COOKIES` | `false` | Set `true` when served over HTTPS |
| `GUITHUB_TRUST_PROXY` | `false` | Set `true` behind a reverse proxy, so rate limiting sees real client IPs |
| `GUITHUB_PUBLIC_URL` | (derived) | Origin used to build invite links, e.g. `https://tabs.example.com` |
| `GUITHUB_WEB_ROOT` | `packages/web/dist` | Built UI assets |

## Using the site

GuitHub lives at **https://guithub.us**. Sign in with the username and password you
chose when you accepted your invite. There is no public sign-up — if you do not have an
account, ask someone in the band for a link.

**Add a song.** From **Songs**, click *New song* and give it a title. Then upload the
first Guitar Pro file. The title and artist come from the file itself if it has them,
so do not worry about matching them exactly.

**Upload a new version.** Open the song and use *Upload version*. Write a short message
saying what you changed — "tightened the bridge", "Dave's solo, take 3" — the same way
you would name a take. That message is what everyone sees in the history, so it is
worth the ten seconds.

**See what changed.** *Compare* puts two versions side by side and highlights the bars
that differ on the score itself, with a note-level list underneath: *"Bar 12, beat 1:
string 5, fret 7 → 9"*. Any two versions, not just neighbouring ones.

**See who wrote what.** *Blame* colours every bar by whoever last changed it, or by
age. This survives bars moving around — inserting a bar at the top does not reassign
credit for everything below it.

**Get a file back.** *Download* on any version returns the original file, byte for
byte, exactly as it was uploaded. Open it in Guitar Pro as normal.

**Change your password.** Click your name in the top bar. You need your current
password, and changing it signs out any other browser you were signed in on — which is
what you want if the reason you are changing it is that the old one got out.

### Updating the live site

```bash
ssh <user>@<server> 'cd /opt/guithub && git pull && docker compose up -d --build'
```

Songs and accounts live in `data/`, which is untouched by a rebuild.

## Accounts and invites

**There is no public sign-up, and no unauthenticated way to create an account** — not
even on an empty database. An endpoint that grants admin to its first caller is a land
grab on a public URL, so the first administrator is made with `create-admin`, which
requires a shell on the server.

Everyone else joins by invite. An admin creates a link on the **Members** page and
sends it over; the invitee picks their own username and password, so nobody ever
handles anyone else's credentials. Anyone can change their own password afterwards from
their account page, and no admin can set somebody else's — blame only means something
if nobody else can become you. Links are single-use, expire after 7 days, and can
be revoked. Only the SHA-256 of a token is stored, so a copy of the database — a
backup, a stolen disk — cannot be used to claim an invite.

Repeated failed logins are rate limited.

## Backups

`scripts/backup.sh <data-dir> <backup-dir>` writes a dated directory containing a
`git bundle` of every song and a consistent copy of the database. Each bundle is a
complete, self-contained clone: it can be restored with plain `git clone` even without
GuitHub.

`scripts/offsite-backup.sh <data-dir>` wraps that with [restic](https://restic.net),
pushing an encrypted, deduplicated copy to object storage and applying retention.
Cloudflare R2 gives 10 GB free, which is a decade of tabs many times over. Put the
credentials in a root-only `/etc/guithub/backup.env` — never in git:

```bash
RESTIC_REPOSITORY=s3:https://<account>.r2.cloudflarestorage.com/guithub-backup
RESTIC_PASSWORD=<long passphrase — without it the backup is unreadable>
AWS_ACCESS_KEY_ID=<R2 access key>
AWS_SECRET_ACCESS_KEY=<R2 secret key>
HEALTHCHECK_URL=https://hc-ping.com/<uuid>          # optional but recommended
```

Run it nightly with a systemd timer (or cron):

```
0 3 * * * /opt/guithub/scripts/offsite-backup.sh /opt/guithub/data
```

The `HEALTHCHECK_URL` matters more than it looks. A backup that has been failing
silently for three months is worse than no backup, because you believe you are covered.
[healthchecks.io](https://healthchecks.io) is free and emails you when a run is missed.

### Do the restore drill

**Before you rely on any of this, restore it once on purpose.**

```bash
restic snapshots
restic restore latest --target /tmp/drill
git clone /tmp/drill/**/songs/<song-id>.bundle /tmp/recovered
ls /tmp/recovered            # song.json, structure.tab, tracks/, original.gp
```

Open the recovered `.gp` in Guitar Pro. If it plays, your backups work. This is a
decade of the band's writing; it deserves a rehearsal rather than a hope.

## Layout

```
packages/core/     canonicaliser and diff engine — pure, no I/O, heavily tested
packages/server/   API, git storage, SQLite, auth
packages/web/      React UI and the alphaTab renderer
fixtures/          test corpus (.atex sources and the .gp files built from them)
scripts/           backup and development helpers
deploy/            Caddyfile
Dockerfile, docker-compose.yml
```

## Tests

```bash
npm test
```

Covering, among others: the canonicaliser is deterministic and survives a Guitar Pro
export round trip; the diff conserves every bar (nothing lost or invented) under
property-based testing; inserting a bar reports one addition rather than a rewrite;
and blame keeps credit with the original author when bars move.
