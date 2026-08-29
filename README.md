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

## Supported formats

Reading (via [alphaTab](https://github.com/CoderLine/alphaTab), MPL-2.0): Guitar Pro
3–5 (`.gp3`, `.gp4`, `.gp5`), Guitar Pro 6 (`.gpx`), Guitar Pro 7/8 (`.gp`),
MusicXML (`.xml`, `.musicxml`, `.mxl`) and Capella (`.cap`, `.capx`).

Since the original file is stored untouched, downloads always open in Guitar Pro
exactly as they were saved.

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

## Accounts and invites

**There is no public sign-up, and no unauthenticated way to create an account** 

Repeated failed logins are rate limited.
