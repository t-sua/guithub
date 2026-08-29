import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp, isCommitish, isTrackPath, sanitiseFilename } from '../src/app.js';
import { openDatabase, type Db } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { createInvite } from '../src/invites.js';
import { createReset } from '../src/resets.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures');

let app: FastifyInstance;
let db: Db;
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'guithub-api-'));
  db = openDatabase(join(dataDir, 'guithub.db'));
  app = await buildApp({ db, dataDir });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
  await rm(dataDir, { recursive: true, force: true });
});

const ADMIN_PASSWORD = 'correct horse battery staple';

/**
 * Seeds the first admin the way the real deployment does — directly, via the CLI path
 * — because there is deliberately no unauthenticated HTTP route that creates one.
 */
async function signUpFirstUser(): Promise<string> {
  await createUser(db, {
    username: 'alice',
    displayName: 'Alice',
    email: 'alice@band.test',
    password: ADMIN_PASSWORD,
    isAdmin: true
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username: 'alice', password: ADMIN_PASSWORD }
  });
  expect(login.statusCode).toBe(200);
  return login.cookies[0]!.value;
}

async function addMember(cookie: string, username: string): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/users',
    cookies: { guithub_session: cookie },
    payload: {
      username,
      displayName: username[0]!.toUpperCase() + username.slice(1),
      email: `${username}@band.test`,
      password: 'another good passphrase'
    }
  });
  expect(created.statusCode).toBe(201);

  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { username, password: 'another good passphrase' }
  });
  expect(login.statusCode).toBe(200);
  return login.cookies[0]!.value;
}

async function createSong(cookie: string, title: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/songs',
    cookies: { guithub_session: cookie },
    payload: { title }
  });
  expect(response.statusCode).toBe(201);
  return response.json().song.slug as string;
}

async function uploadVersion(
  cookie: string,
  slug: string,
  fixture: string,
  message: string
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const bytes = await readFile(join(FIXTURES, fixture));
  const boundary = '----guithubtest';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="message"\r\n\r\n${message}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fixture}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const response = await app.inject({
    method: 'POST',
    url: `/api/songs/${slug}/versions`,
    cookies: { guithub_session: cookie },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload
  });
  return { statusCode: response.statusCode, body: response.json() };
}

describe('setup and authentication', () => {
  it('refuses to create an account over HTTP even with an empty database', async () => {
    // The regression that matters most for a public deployment: there must be no
    // unauthenticated path to an account, or the first stranger to find the host
    // becomes the admin of the instance.
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: {
        username: 'mallory',
        displayName: 'Mallory',
        email: 'm@example.test',
        password: 'let me in please'
      }
    });
    expect(response.statusCode).toBe(401);

    const me = await app.inject({ method: 'GET', url: '/api/me' });
    expect(me.json().user).toBeNull();
  });

  it('signs in the seeded admin', async () => {
    const cookie = await signUpFirstUser();
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { guithub_session: cookie } });
    expect(me.json().user).toMatchObject({ username: 'alice', isAdmin: true });
  });

  it('refuses a second account created by a stranger', async () => {
    await signUpFirstUser();
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: {
        username: 'mallory',
        displayName: 'Mallory',
        email: 'm@example.test',
        password: 'let me in please'
      }
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a wrong password and a wrong username alike', async () => {
    await signUpFirstUser();
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alice', password: 'nope' }
    });
    const noSuchUser = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'nobody', password: 'nope' }
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(noSuchUser.json().error).toBe(wrongPassword.json().error);
  });

  it('locks every song endpoint behind a session', async () => {
    await signUpFirstUser();
    for (const url of ['/api/songs', '/api/songs/anything', '/api/users', '/api/invites']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('ends the session on logout', async () => {
    const cookie = await signUpFirstUser();
    await app.inject({ method: 'POST', url: '/api/logout', cookies: { guithub_session: cookie } });
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { guithub_session: cookie } });
    expect(me.json().user).toBeNull();
  });
});

describe('changing a password', () => {
  async function changePassword(
    cookie: string,
    currentPassword: string,
    newPassword: string
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/me/password',
      cookies: { guithub_session: cookie },
      payload: { currentPassword, newPassword }
    });
  }

  it('replaces the password, and the old one stops working', async () => {
    const cookie = await signUpFirstUser();
    const changed = await changePassword(cookie, ADMIN_PASSWORD, 'a whole new passphrase');
    expect(changed.statusCode).toBe(200);

    const withOld = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alice', password: ADMIN_PASSWORD }
    });
    expect(withOld.statusCode).toBe(401);

    const withNew = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alice', password: 'a whole new passphrase' }
    });
    expect(withNew.statusCode).toBe(200);
  });

  it('refuses without the current password', async () => {
    const cookie = await signUpFirstUser();
    const response = await changePassword(cookie, 'not my password', 'a whole new passphrase');
    expect(response.statusCode).toBe(401);

    // The old password must still work: a failed attempt changes nothing.
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alice', password: ADMIN_PASSWORD }
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses a new password that is too short, or the same as the old one', async () => {
    const cookie = await signUpFirstUser();
    expect((await changePassword(cookie, ADMIN_PASSWORD, 'short')).statusCode).toBe(400);
    expect((await changePassword(cookie, ADMIN_PASSWORD, ADMIN_PASSWORD)).statusCode).toBe(400);
  });

  it('refuses anyone who is not signed in', async () => {
    await signUpFirstUser();
    const response = await app.inject({
      method: 'POST',
      url: '/api/me/password',
      payload: { currentPassword: ADMIN_PASSWORD, newPassword: 'a whole new passphrase' }
    });
    expect(response.statusCode).toBe(401);
  });

  it('signs out the other sessions but keeps the one making the change', async () => {
    const first = await signUpFirstUser();
    const second = (
      await app.inject({
        method: 'POST',
        url: '/api/login',
        payload: { username: 'alice', password: ADMIN_PASSWORD }
      })
    ).cookies[0]!.value;

    // Both are live before the change.
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', cookies: { guithub_session: second } }))
        .json().user
    ).toMatchObject({ username: 'alice' });

    await changePassword(first, ADMIN_PASSWORD, 'a whole new passphrase');

    const stale = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { guithub_session: second }
    });
    expect(stale.json().user).toBeNull();

    const current = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { guithub_session: first }
    });
    expect(current.json().user).toMatchObject({ username: 'alice' });
  });

  it('does not touch anybody else\'s sessions', async () => {
    const admin = await signUpFirstUser();
    const bob = await addMember(admin, 'bob');

    await changePassword(admin, ADMIN_PASSWORD, 'a whole new passphrase');

    const stillIn = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { guithub_session: bob }
    });
    expect(stillIn.json().user).toMatchObject({ username: 'bob' });
  });
});

describe('password resets', () => {
  async function issueReset(adminCookie: string, userId: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/resets',
      cookies: { guithub_session: adminCookie },
      payload: { userId }
    });
    return response;
  }

  function tokenFrom(url: string): string {
    return url.slice(url.lastIndexOf('/') + 1);
  }

  async function bobsId(adminCookie: string): Promise<string> {
    const users = await app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: { guithub_session: adminCookie }
    });
    return (users.json().users as { id: string; username: string }[]).find(
      u => u.username === 'bob'
    )!.id;
  }

  it('lets someone who forgot their password choose a new one', async () => {
    const admin = await signUpFirstUser();
    await addMember(admin, 'bob');
    const issued = await issueReset(admin, await bobsId(admin));
    expect(issued.statusCode).toBe(201);

    const token = tokenFrom(issued.json().url as string);
    const redeemed = await app.inject({
      method: 'POST',
      url: '/api/resets/accept',
      payload: { token, password: 'a brand new passphrase' }
    });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json().user).toMatchObject({ username: 'bob' });

    // Redeeming signs you in, so you are not left at a login screen.
    const cookie = redeemed.cookies[0]!.value;
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { guithub_session: cookie }
    });
    expect(me.json().user).toMatchObject({ username: 'bob' });

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'bob', password: 'a brand new passphrase' }
    });
    expect(login.statusCode).toBe(200);
  });

  it('never grants admin through a reset', async () => {
    const admin = await signUpFirstUser();
    await addMember(admin, 'bob');
    const issued = await issueReset(admin, await bobsId(admin));
    const redeemed = await app.inject({
      method: 'POST',
      url: '/api/resets/accept',
      payload: { token: tokenFrom(issued.json().url as string), password: 'a brand new passphrase' }
    });
    expect(redeemed.json().user.isAdmin).toBe(false);
  });

  it('signs out every session the account had open', async () => {
    const admin = await signUpFirstUser();
    const bobCookie = await addMember(admin, 'bob');
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', cookies: { guithub_session: bobCookie } }))
        .json().user
    ).toMatchObject({ username: 'bob' });

    const issued = await issueReset(admin, await bobsId(admin));
    await app.inject({
      method: 'POST',
      url: '/api/resets/accept',
      payload: { token: tokenFrom(issued.json().url as string), password: 'a brand new passphrase' }
    });

    const stale = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { guithub_session: bobCookie }
    });
    expect(stale.json().user).toBeNull();
  });

  it('accepts a link exactly once', async () => {
    const admin = await signUpFirstUser();
    await addMember(admin, 'bob');
    const issued = await issueReset(admin, await bobsId(admin));
    const token = tokenFrom(issued.json().url as string);

    const first = await app.inject({
      method: 'POST',
      url: '/api/resets/accept',
      payload: { token, password: 'a brand new passphrase' }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/resets/accept',
      payload: { token, password: 'someone elses idea' }
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().problem).toBe('used');
  });

  it('issuing a new link invalidates the previous one', async () => {
    const admin = await signUpFirstUser();
    await addMember(admin, 'bob');
    const id = await bobsId(admin);
    const first = tokenFrom((await issueReset(admin, id)).json().url as string);
    const second = tokenFrom((await issueReset(admin, id)).json().url as string);

    const stale = await app.inject({
      method: 'POST',
      url: '/api/resets/accept',
      payload: { token: first, password: 'a brand new passphrase' }
    });
    expect(stale.statusCode).toBe(400);

    const fresh = await app.inject({
      method: 'POST',
      url: '/api/resets/accept',
      payload: { token: second, password: 'a brand new passphrase' }
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('refuses an expired link', async () => {
    const admin = await signUpFirstUser();
    await addMember(admin, 'bob');
    const id = await bobsId(admin);
    const { token } = createReset(db, {
      userId: id,
      createdBy: id,
      now: new Date(Date.now() - 48 * 60 * 60 * 1000)
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/resets/accept',
      payload: { token, password: 'a brand new passphrase' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().problem).toBe('expired');
  });

  it('refuses an unknown token, and a password that is too short', async () => {
    const admin = await signUpFirstUser();
    await addMember(admin, 'bob');
    const issued = await issueReset(admin, await bobsId(admin));

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/resets/accept',
          payload: { token: 'not-a-real-token', password: 'a brand new passphrase' }
        })
      ).statusCode
    ).toBe(400);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/resets/accept',
          payload: { token: tokenFrom(issued.json().url as string), password: 'short' }
        })
      ).statusCode
    ).toBe(400);
  });

  it('only lets an admin issue, list or revoke a reset', async () => {
    const admin = await signUpFirstUser();
    const bobCookie = await addMember(admin, 'bob');
    const id = await bobsId(admin);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/resets',
          cookies: { guithub_session: bobCookie },
          payload: { userId: id }
        })
      ).statusCode
    ).toBe(403);

    expect(
      (await app.inject({ method: 'GET', url: '/api/resets', cookies: { guithub_session: bobCookie } }))
        .statusCode
    ).toBe(403);

    expect((await app.inject({ method: 'POST', url: '/api/resets', payload: { userId: id } })).statusCode).toBe(401);
  });

  it('keeps a used reset on the record, and can revoke an unused one', async () => {
    const admin = await signUpFirstUser();
    await addMember(admin, 'bob');
    const id = await bobsId(admin);
    const issued = await issueReset(admin, id);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/resets',
      cookies: { guithub_session: admin }
    });
    expect(listed.json().resets).toHaveLength(1);
    expect(listed.json().resets[0]).toMatchObject({ username: 'bob', issuedBy: 'Alice', used: false });

    await app.inject({
      method: 'POST',
      url: '/api/resets/accept',
      payload: { token: tokenFrom(issued.json().url as string), password: 'a brand new passphrase' }
    });

    // The audit trail survives use — that is what makes an admin-issued reset
    // accountable rather than invisible.
    const after = await app.inject({
      method: 'GET',
      url: '/api/resets',
      cookies: { guithub_session: admin }
    });
    expect(after.json().resets[0]).toMatchObject({ used: true });

    // A used one cannot be revoked away.
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/resets/${after.json().resets[0].id}`,
      cookies: { guithub_session: admin }
    });
    expect(revoked.statusCode).toBe(404);
  });

  it('stores only the hash of a token', async () => {
    const admin = await signUpFirstUser();
    await addMember(admin, 'bob');
    const issued = await issueReset(admin, await bobsId(admin));
    const token = tokenFrom(issued.json().url as string);
    const rows = db.prepare('SELECT token_hash FROM password_resets').all() as {
      token_hash: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(token);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('invites', () => {
  async function issueInvite(cookie: string, label = 'bass player'): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/invites',
      cookies: { guithub_session: cookie },
      payload: { label }
    });
    expect(response.statusCode).toBe(201);
    const url = response.json().url as string;
    return url.slice(url.lastIndexOf('/') + 1);
  }

  const accept = (token: string, username = 'dave') =>
    app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      payload: {
        token,
        username,
        displayName: 'Dave Okafor',
        email: `${username}@band.test`,
        password: 'a perfectly fine passphrase'
      }
    });

  it('lets an invited person choose their own account and signs them in', async () => {
    const alice = await signUpFirstUser();
    const token = await issueInvite(alice);

    const check = await app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect(check.json()).toMatchObject({ ok: true, label: 'bass player' });

    const response = await accept(token);
    expect(response.statusCode).toBe(201);
    expect(response.json().user).toMatchObject({ username: 'dave', isAdmin: false });

    const cookie = response.cookies[0]!.value;
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { guithub_session: cookie } });
    expect(me.json().user).toMatchObject({ username: 'dave' });
  });

  it('never grants admin through an invite', async () => {
    const alice = await signUpFirstUser();
    const token = await issueInvite(alice);
    // Even when the caller asks for it.
    const response = await app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      payload: {
        token,
        username: 'dave',
        displayName: 'Dave',
        email: 'd@band.test',
        password: 'a perfectly fine passphrase',
        isAdmin: true
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().user.isAdmin).toBe(false);
  });

  it('accepts an invite exactly once', async () => {
    const alice = await signUpFirstUser();
    const token = await issueInvite(alice);

    expect((await accept(token, 'dave')).statusCode).toBe(201);
    const second = await accept(token, 'mallory');
    expect(second.statusCode).toBe(400);
    expect(second.json().problem).toBe('used');
  });

  it('refuses an unknown token', async () => {
    await signUpFirstUser();
    const response = await accept('not-a-real-token-at-all');
    expect(response.statusCode).toBe(400);
    expect(response.json().problem).toBe('unknown');
  });

  it('refuses an expired invite', async () => {
    const alice = await signUpFirstUser();
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { guithub_session: alice } });
    const adminId = me.json().user.id as string;
    // Issued far enough in the past that it has lapsed.
    const { token } = createInvite(db, {
      createdBy: adminId,
      ttlDays: 7,
      now: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    });

    const response = await accept(token);
    expect(response.statusCode).toBe(400);
    expect(response.json().problem).toBe('expired');
  });

  it('stores only the hash of a token', async () => {
    const alice = await signUpFirstUser();
    const token = await issueInvite(alice);
    const rows = db.prepare('SELECT token_hash FROM invites').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(token);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('only lets an admin issue or list invites', async () => {
    const alice = await signUpFirstUser();
    const token = await issueInvite(alice);
    const dave = (await accept(token)).cookies[0]!.value;

    for (const [method, url] of [
      ['POST', '/api/invites'],
      ['GET', '/api/invites']
    ] as const) {
      const response = await app.inject({ method, url, cookies: { guithub_session: dave }, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('revokes a pending invite', async () => {
    const alice = await signUpFirstUser();
    const token = await issueInvite(alice);
    const listed = await app.inject({
      method: 'GET',
      url: '/api/invites',
      cookies: { guithub_session: alice }
    });
    const id = listed.json().invites[0].id as string;

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/invites/${id}`,
      cookies: { guithub_session: alice }
    });
    expect(revoked.statusCode).toBe(200);
    expect((await accept(token)).statusCode).toBe(400);
  });
});

describe('song lifecycle over HTTP', () => {
  it('carries a song from upload through diff, blame and download', async () => {
    const alice = await signUpFirstUser();
    const bob = await addMember(alice, 'bob');
    const slug = await createSong(alice, 'Peppy Crane');

    const v1 = await uploadVersion(alice, slug, 'song-a.gp', 'First pass at the riff');
    expect(v1.statusCode).toBe(201);
    const v2 = await uploadVersion(bob, slug, 'song-a-note-changed.gp', 'Moved the 7 to a 9');
    expect(v2.statusCode).toBe(201);

    // History, newest first, with the right names on it.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/songs/${slug}`,
      cookies: { guithub_session: alice }
    });
    const versions = detail.json().versions as Array<Record<string, string>>;
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ authorName: 'Bob', message: 'Moved the 7 to a 9' });
    expect(detail.json().song).toMatchObject({ title: 'Peppy Crane', versionCount: 2, trackCount: 2 });

    // The diff describes exactly one note.
    const diff = await app.inject({
      method: 'GET',
      url: `/api/songs/${slug}/diff?from=${v1.body.commit as string}&to=${v2.body.commit as string}`,
      cookies: { guithub_session: alice }
    });
    const tracks = diff.json().diff.tracks as Array<Record<string, unknown>>;
    const guitar = tracks.find(track => track.name === 'Guitar 1')!;
    expect(guitar).toMatchObject({ barsModified: 1, barsAdded: 0, barsRemoved: 0 });

    // Blame credits Bob for the bar he changed and Alice for the rest.
    const blame = await app.inject({
      method: 'GET',
      url: `/api/songs/${slug}/blame/${v2.body.commit as string}?path=tracks/01-guitar-1.tab`,
      cookies: { guithub_session: alice }
    });
    const lines = blame.json().blame as Array<Record<string, unknown>>;
    expect(lines.map(line => line.authorName)).toEqual(['Alice', 'Bob', 'Alice', 'Alice']);

    // The download is byte-identical to what was uploaded.
    const download = await app.inject({
      method: 'GET',
      url: `/api/songs/${slug}/versions/${v1.body.commit as string}/file`,
      cookies: { guithub_session: alice }
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('song-a.gp');
    expect(Buffer.from(download.rawPayload).equals(await readFile(join(FIXTURES, 'song-a.gp')))).toBe(true);
  });

  it('explains why a bad file was rejected and stores nothing', async () => {
    const cookie = await signUpFirstUser();
    const slug = await createSong(cookie, 'Broken');
    const boundary = '----guithubtest';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\n\r\n` +
        `just some notes\r\n--${boundary}--\r\n`
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/songs/${slug}/versions`,
      cookies: { guithub_session: cookie },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/Unsupported file type/);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/songs/${slug}`,
      cookies: { guithub_session: cookie }
    });
    expect(detail.json().versions).toEqual([]);
  });

  it('gives songs with the same title distinct addresses', async () => {
    const cookie = await signUpFirstUser();
    expect(await createSong(cookie, 'Untitled')).toBe('untitled');
    expect(await createSong(cookie, 'Untitled')).toBe('untitled-2');
  });
});

describe('input validation', () => {
  it('only accepts commit-shaped version ids', () => {
    expect(isCommitish('a'.repeat(40))).toBe(true);
    expect(isCommitish('abc1234')).toBe(true);
    expect(isCommitish('--upload-pack=evil')).toBe(false);
    expect(isCommitish('HEAD')).toBe(false);
    expect(isCommitish('../../etc/passwd')).toBe(false);
  });

  it('only accepts generated track paths', () => {
    expect(isTrackPath('tracks/01-guitar-1.tab')).toBe(true);
    expect(isTrackPath('structure.tab')).toBe(true);
    expect(isTrackPath('tracks/../../../etc/passwd')).toBe(false);
    expect(isTrackPath('original.gp')).toBe(false);
  });

  it('strips path separators out of download filenames', () => {
    expect(sanitiseFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitiseFilename('')).toBe('tab.gp');
  });

  it('rejects a version id that is not a commit', async () => {
    const cookie = await signUpFirstUser();
    const slug = await createSong(cookie, 'Guard');
    const response = await app.inject({
      method: 'GET',
      url: `/api/songs/${slug}/versions/HEAD`,
      cookies: { guithub_session: cookie }
    });
    expect(response.statusCode).toBe(400);
  });
});
