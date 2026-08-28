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

## Deploying

GuitHub is a stateful single-node app: it drives the `git` binary over bare
repositories and keeps its index in SQLite. It needs a persistent disk and exactly one
instance. That rules out serverless platforms — Cloud Run, which Firebase App Hosting
runs on, has no persistent disk, and its filesystem is wiped when an instance stops.
A small VPS is the right home; about $11/month covers the server, its IPv4 address and
an annualised domain, with backups free under Cloudflare R2's 10 GB tier.

### 1. A server

Any provider works. GuitHub needs a persistent disk, the `git` binary, Docker, and
**at least 2 GB of RAM** — not for running it, but for building it: `npm ci` plus the
Vite build plus compiling `better-sqlite3` will run out of memory in 1 GB.

The recommendation is a **Vultr Cloud Compute** instance, Regular Performance
`vc2-1c-2gb` — 1 vCPU / 2 GB / 55 GB SSD / 2 TB bandwidth, **$10/mo**, running
Ubuntu 24.04 LTS. Unlike Hetzner, Vultr includes an IPv4 address in that price.

Three things are worth knowing before you click Deploy:

- **Add swap before you build.** 2 GB is the build's floor, not its comfort zone, and
  Vultr's Ubuntu images ship with no swap at all. Without it the first
  `docker compose up -d --build` can be OOM-killed partway through `npm ci` or the Vite
  build. The swap commands below take a minute and remove the whole class of problem.
- **Vultr is x86 only.** There is no ARM shared tier, so the arm64 image question that
  mattered elsewhere does not arise here — and your laptop, if it is x86, now builds the
  same architecture the server runs.
- **Pick the region before the plan.** Regular Performance is Vultr's older Intel tier
  and is not offered in every location; if it does not appear, the same box on newer
  hardware is High Performance `vhp-1c-2gb` (AMD or Intel, NVMe) at about $12/mo, which
  is a fair upgrade for two dollars. High Frequency (~$18/mo) is more CPU than a tab
  server will ever use.

Bandwidth is 2 TB with overage at $0.01/GB. A decade of the band's tabs is measured in
megabytes, so this is not a number you will ever look at again.

Vultr also offers a **Cloud Firewall** in the control panel, which filters at the network
edge before traffic reaches the instance. Using it as well as `ufw` is worthwhile: create
a firewall group allowing TCP 80 and 443 from anywhere and TCP 22 from your own address,
then attach it to the instance. The two are belt and braces — `ufw` still protects you if
the firewall group is ever detached.

Vultr hands you a root password rather than a configured user, so harden it first. **Add
your SSH key before you disable password logins**, or you will lock yourself out of your
own server:

```bash
adduser guithub && usermod -aG sudo guithub

# Install your public key for the new user — do this BEFORE the sed below.
install -d -m 700 -o guithub -g guithub /home/guithub/.ssh
# From your laptop:  ssh-copy-id guithub@<server-ip>
# or paste the key:  nano /home/guithub/.ssh/authorized_keys
chown guithub:guithub /home/guithub/.ssh/authorized_keys && chmod 600 /home/guithub/.ssh/authorized_keys
```

Now open a **second terminal** and confirm `ssh guithub@<server-ip>` works while you are
still logged in as root on the first. Only then continue — the rest runs as `guithub`:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
sudo apt update && sudo apt install -y unattended-upgrades

# SSH keys only:
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# 2 GB of swap, so the build cannot be OOM-killed:
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf

curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$USER"
```

Log out and back in so the `docker` group applies, then check `free -h` shows 2 GB of
swap. `vm.swappiness=10` keeps the kernel from paging out the running server just because
swap exists — it is there for the build spike, not for everyday use.

If you ever do lock yourself out, Vultr's web console in the control panel gets you back
in over the hypervisor without SSH. That is the safety net; it is not a plan.

### 2. A domain

Register one (~$10–15/yr; Cloudflare Registrar sells at cost). Point an `A` record at
the server's IP, **DNS-only** — if you use Cloudflare, leave the cloud grey so Caddy
can complete the ACME challenge directly.

### 3. Deploy

```bash
sudo mkdir -p /opt/guithub && sudo chown "$USER" /opt/guithub
git clone https://github.com/t-sua/guithub /opt/guithub && cd /opt/guithub
cp .env.example .env && $EDITOR .env          # set GUITHUB_DOMAIN and ACME_EMAIL
mkdir -p data                                  # must be owned by uid 1000
docker compose up -d --build
```

Caddy gets a certificate on first request. Then create the one account that cannot be
created over the network:

```bash
docker compose exec guithub npm run create-admin --   --username you --name "Your Name" --email you@example.com
```

It prints a generated password once. Sign in, then invite everyone else.

### Updating

```bash
cd /opt/guithub && git pull && docker compose up -d --build
```

About a minute of downtime. Logs: `docker compose logs -f guithub`.

## Accounts and invites

**There is no public sign-up, and no unauthenticated way to create an account** — not
even on an empty database. An endpoint that grants admin to its first caller is a land
grab on a public URL, so the first administrator is made with `create-admin`, which
requires a shell on the server.

Everyone else joins by invite. An admin creates a link on the **Members** page and
sends it over; the invitee picks their own username and password, so nobody ever
handles anyone else's credentials. Links are single-use, expire after 7 days, and can
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
