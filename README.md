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

- Node.js 22 LTS or newer
- git (used as the storage engine)
- A C toolchain, for `better-sqlite3` (`build-essential` on Debian/Ubuntu)

## Running it

```bash
npm install
npm run build
npm test

GUITHUB_DATA_DIR=./data node packages/server/dist/main.js
```

Then open <http://127.0.0.1:8080>. The first account you create becomes the admin and
can add the rest of the band from the **Members** page. There is no public signup.

### Development

```bash
npm run build -w @guithub/core      # the web and server both depend on this
node packages/server/dist/main.js  # API on :8080
npm run dev -w @guithub/web         # UI on :5173, proxying /api to :8080
```

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `GUITHUB_DATA_DIR` | `./data` | Song repositories and the SQLite database |
| `GUITHUB_HOST` | `127.0.0.1` | Bind address |
| `GUITHUB_PORT` | `8080` | Port |
| `GUITHUB_SECURE_COOKIES` | `false` | Set `true` when served over HTTPS |
| `GUITHUB_WEB_ROOT` | `packages/web/dist` | Built UI assets |

## Deploying

`deploy/guithub.service` is a hardened systemd unit and `deploy/Caddyfile` puts Caddy
in front of it with automatic HTTPS. Both need the hostname and paths adjusted.

```bash
sudo cp deploy/guithub.service /etc/systemd/system/
sudo systemctl enable --now guithub
```

## Backups

`scripts/backup.sh <data-dir> <backup-dir>` writes a dated directory containing a
`git bundle` of every song and a consistent copy of the database. Each bundle is a
complete, self-contained clone: it can be restored with plain `git clone` even
without GuitHub.

```bash
15 3 * * * /opt/guithub/scripts/backup.sh /var/lib/guithub /mnt/backup/guithub
```

Restore instructions are written into every backup as `MANIFEST.txt`. **Run the
restore once, on purpose, before you need it.** This is the band's writing history.

## Layout

```
packages/core/     canonicaliser and diff engine — pure, no I/O, heavily tested
packages/server/   API, git storage, SQLite, auth
packages/web/      React UI and the alphaTab renderer
fixtures/          test corpus (.atex sources and the .gp files built from them)
scripts/           backup and development helpers
deploy/            systemd unit and Caddyfile
```

## Tests

```bash
npm test
```

Covering, among others: the canonicaliser is deterministic and survives a Guitar Pro
export round trip; the diff conserves every bar (nothing lost or invented) under
property-based testing; inserting a bar reports one addition rather than a rewrite;
and blame keeps credit with the original author when bars move.
