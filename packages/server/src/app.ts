import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { diffSongs, type CanonicalSong } from '@guithub/core';
import type { Db, SongRow } from './db.js';
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  authenticate,
  createSession,
  createUser,
  deleteSession,
  findSessionUser,
  findUserById,
  listUsers,
  toPublicUser,
  updatePassword,
  verifyPassword,
  type PublicUser
} from './auth.js';
import {
  createSong,
  getSongBySlug,
  listSongs,
  recordVersion,
  repoDirFor
} from './library.js';
import {
  INVITE_TTL_DAYS,
  InviteError,
  acceptInvite,
  createInvite,
  findUsableInvite,
  listInvites,
  revokeInvite
} from './invites.js';
import { blameTrack, listVersions, readTextAt } from './history.js';
import {
  ACCEPTED_EXTENSIONS,
  UploadError,
  commitVersion,
  readCanonicalAt,
  readOriginalAt,
  readProvenanceAt
} from './songs.js';

export interface AppOptions {
  readonly db: Db;
  readonly dataDir: string;
  readonly maxUploadBytes?: number;
  /** Set false when serving over plain HTTP on a trusted LAN. */
  readonly secureCookies?: boolean;
  /** Enable when running behind a reverse proxy such as Caddy. */
  readonly trustProxy?: boolean;
  /** Absolute origin used to build invite links, e.g. https://tabs.example.com */
  readonly publicUrl?: string;
  readonly logger?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicUser;
  }
}

const DEFAULT_MAX_UPLOAD = 25 * 1024 * 1024;

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { db, dataDir } = options;
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD;

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
    // Caddy terminates TLS in front of this. Without trusting it, every request
    // appears to come from the proxy and rate limiting would key on a single IP.
    trustProxy: options.trustProxy ?? false
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: maxUploadBytes, files: 1, fields: 10 }
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  app.decorateRequest('user', undefined);

  app.addHook('preHandler', async request => {
    const sessionId = request.cookies[SESSION_COOKIE];
    if (!sessionId) return;
    const user = findSessionUser(db, sessionId);
    if (user) request.user = toPublicUser(user);
  });

  function requireUser(request: FastifyRequest, reply: FastifyReply): PublicUser | null {
    if (!request.user) {
      void reply.code(401).send({ error: 'Sign in to continue.' });
      return null;
    }
    return request.user;
  }

  function setSessionCookie(reply: FastifyReply, sessionId: string): void {
    void reply.setCookie(SESSION_COOKIE, sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: options.secureCookies ?? false,
      maxAge: SESSION_DAYS * 24 * 60 * 60
    });
  }

  const credentialsSchema = z.object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(512)
  });

  /** Slow enough to make guessing pointless, loose enough to survive a typo. */
  const strictLimit = {
    rateLimit: { max: 10, timeWindow: '5 minutes' }
  } as const;

  app.post('/api/login', { config: strictLimit }, async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a username and password.' });

    const user = await authenticate(db, parsed.data.username, parsed.data.password);
    if (!user) return reply.code(401).send({ error: 'Incorrect username or password.' });

    const session = createSession(db, user.id);
    setSessionCookie(reply, session.id);
    return { user: toPublicUser(user) };
  });

  app.post('/api/logout', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    if (sessionId) deleteSession(db, sessionId);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async request => ({ user: request.user ?? null }));

  const passwordChangeSchema = z.object({
    currentPassword: z.string().min(1).max(512),
    newPassword: z.string().min(8).max(512)
  });

  /**
   * Changes your own password. There is deliberately no route for an admin to set
   * somebody else's: blame attributes bars to a person, and that only means something
   * if nobody else can become them. An admin who needs to remove access revokes the
   * account rather than taking it over.
   */
  app.post('/api/me/password', { config: strictLimit }, async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    const parsed = passwordChangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'A new password needs at least 8 characters.' });
    }
    const { currentPassword, newPassword } = parsed.data;

    // The session already proves who this is, so re-asking for the current password
    // is not about identity — it is what stops someone at an unattended browser from
    // locking the owner out of their own account.
    const row = findUserById(db, user.id);
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      return reply.code(401).send({ error: 'That is not your current password.' });
    }
    if (currentPassword === newPassword) {
      return reply.code(400).send({ error: 'The new password must be different from the old one.' });
    }

    await updatePassword(db, user.id, newPassword, request.cookies[SESSION_COOKIE]);
    return { ok: true };
  });

  const newUserSchema = z.object({
    username: z
      .string()
      .min(2)
      .max(32)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, dashes or underscores.'),
    displayName: z.string().min(1).max(64),
    email: z.string().email().max(200),
    password: z.string().min(8).max(512)
  });

  /**
   * Adds a member directly. Admin only, with no unauthenticated path — not even when
   * the user table is empty. An endpoint that hands admin to its first caller is a
   * land grab on a public URL; the first administrator is created with the
   * `create-admin` CLI, which requires access to the server itself.
   */
  app.post('/api/users', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!user.isAdmin) return reply.code(403).send({ error: 'Only an admin can add members.' });

    const parsed = newUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid details.' });
    }

    try {
      const created = await createUser(db, { ...parsed.data, isAdmin: false });
      return reply.code(201).send({ user: created });
    } catch (error) {
      if (String(error).includes('UNIQUE')) {
        return reply.code(409).send({ error: 'That username is already taken.' });
      }
      throw error;
    }
  });

  app.get('/api/users', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return { users: listUsers(db) };
  });

  // -------------------------------------------------------------------------
  // Invites
  // -------------------------------------------------------------------------

  function inviteUrl(request: FastifyRequest, token: string): string {
    if (options.publicUrl) return `${options.publicUrl.replace(/\/$/, '')}/invite/${token}`;
    const host = request.headers.host ?? 'localhost';
    return `${request.protocol}://${host}/invite/${token}`;
  }

  /** Issues a single-use invite link. The token is returned here and nowhere else. */
  app.post('/api/invites', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!user.isAdmin) return reply.code(403).send({ error: 'Only an admin can invite people.' });

    const parsed = z
      .object({ label: z.string().max(100).optional() })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid invite.' });

    const { token, invite } = createInvite(db, {
      createdBy: user.id,
      label: parsed.data.label ?? ''
    });
    return reply.code(201).send({
      invite,
      url: inviteUrl(request, token),
      expiresInDays: INVITE_TTL_DAYS
    });
  });

  app.get('/api/invites', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!user.isAdmin) return reply.code(403).send({ error: 'Only an admin can see invites.' });
    return { invites: listInvites(db) };
  });

  app.delete('/api/invites/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!user.isAdmin) return reply.code(403).send({ error: 'Only an admin can revoke invites.' });
    const { id } = request.params as { id: string };
    if (!revokeInvite(db, id)) {
      return reply.code(404).send({ error: 'No such pending invite.' });
    }
    return { ok: true };
  });

  /** Checks a link without consuming it, so the sign-up page can explain itself. */
  app.get('/api/invites/:token', { config: strictLimit }, async (request, reply) => {
    const { token } = request.params as { token: string };
    try {
      const invite = findUsableInvite(db, token);
      return { ok: true, label: invite.label };
    } catch (error) {
      if (error instanceof InviteError) {
        return reply.code(404).send({ error: error.message, problem: error.problem });
      }
      throw error;
    }
  });

  /** Redeems an invite. The invitee chooses their own username and password. */
  app.post('/api/invites/accept', { config: strictLimit }, async (request, reply) => {
    const parsed = newUserSchema
      .extend({ token: z.string().min(10).max(200) })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid details.' });
    }

    try {
      const user = await acceptInvite(db, parsed.data);
      const session = createSession(db, user.id);
      setSessionCookie(reply, session.id);
      return reply.code(201).send({ user });
    } catch (error) {
      if (error instanceof InviteError) {
        return reply.code(400).send({ error: error.message, problem: error.problem });
      }
      if (String(error).includes('UNIQUE')) {
        return reply.code(409).send({ error: 'That username is already taken.' });
      }
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // Songs
  // -------------------------------------------------------------------------

  function songOr404(slug: string, reply: FastifyReply): SongRow | null {
    const song = getSongBySlug(db, slug);
    if (!song) {
      void reply.code(404).send({ error: 'No such song.' });
      return null;
    }
    return song;
  }

  app.get('/api/songs', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return { songs: listSongs(db).map(toPublicSong) };
  });

  app.post('/api/songs', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = z
      .object({ title: z.string().min(1).max(200), artist: z.string().max(200).optional() })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A song needs a title.' });

    const song = await createSong(db, {
      title: parsed.data.title,
      artist: parsed.data.artist ?? '',
      userId: user.id,
      dataDir
    });
    return reply.code(201).send({ song: toPublicSong(song) });
  });

  app.get('/api/songs/:slug', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const { slug } = request.params as { slug: string };
    const song = songOr404(slug, reply);
    if (!song) return;
    const versions = await listVersions(repoDirFor(dataDir, song.id));
    return { song: toPublicSong(song), versions };
  });

  /** Uploads a new version of a song. */
  app.post('/api/songs/:slug/versions', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { slug } = request.params as { slug: string };
    const song = songOr404(slug, reply);
    if (!song) return;

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Attach a tab file.' });

    const bytes = await file.toBuffer();
    if (file.file.truncated) {
      return reply.code(413).send({
        error: `That file is larger than ${Math.floor(maxUploadBytes / (1024 * 1024))} MB.`
      });
    }

    const messageField = file.fields['message'];
    const message =
      messageField && 'value' in messageField ? String(messageField.value).slice(0, 500) : '';

    try {
      const result = await commitVersion({
        repoDir: repoDirFor(dataDir, song.id),
        bytes,
        filename: file.filename,
        message,
        author: { name: user.displayName, email: user.email }
      });
      recordVersion(db, song.id, result, user.id);
      return reply.code(201).send({ commit: result.commit, message });
    } catch (error) {
      if (error instanceof UploadError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  /** The canonical form of one version, for rendering and for the diff view. */
  app.get('/api/songs/:slug/versions/:commit', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const { slug, commit } = request.params as { slug: string; commit: string };
    const song = songOr404(slug, reply);
    if (!song) return;
    if (!isCommitish(commit)) return reply.code(400).send({ error: 'Bad version id.' });

    const repoDir = repoDirFor(dataDir, song.id);
    const canonical = await readCanonicalAt(repoDir, commit);
    if (!canonical) return reply.code(404).send({ error: 'No such version.' });
    const provenance = await readProvenanceAt(repoDir, commit);
    return { canonical: serialiseCanonical(canonical), provenance };
  });

  /** The exact bytes that were uploaded for this version. */
  app.get('/api/songs/:slug/versions/:commit/file', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const { slug, commit } = request.params as { slug: string; commit: string };
    const song = songOr404(slug, reply);
    if (!song) return;
    if (!isCommitish(commit)) return reply.code(400).send({ error: 'Bad version id.' });

    const original = await readOriginalAt(repoDirFor(dataDir, song.id), commit);
    if (!original) return reply.code(404).send({ error: 'No file stored for that version.' });

    return reply
      .header('content-type', 'application/octet-stream')
      .header(
        'content-disposition',
        `attachment; filename="${sanitiseFilename(original.filename)}"`
      )
      .send(original.bytes);
  });

  /** Compares two versions. */
  app.get('/api/songs/:slug/diff', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const { slug } = request.params as { slug: string };
    const query = z
      .object({ from: z.string(), to: z.string() })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Choose two versions to compare.' });
    if (!isCommitish(query.data.from) || !isCommitish(query.data.to)) {
      return reply.code(400).send({ error: 'Bad version id.' });
    }

    const song = songOr404(slug, reply);
    if (!song) return;
    const repoDir = repoDirFor(dataDir, song.id);
    const before = await readCanonicalAt(repoDir, query.data.from);
    const after = await readCanonicalAt(repoDir, query.data.to);
    if (!before || !after) return reply.code(404).send({ error: 'No such version.' });

    return { diff: diffSongs(before, after) };
  });

  /** Per-bar authorship for one track. */
  app.get('/api/songs/:slug/blame/:commit', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const { slug, commit } = request.params as { slug: string; commit: string };
    const query = z.object({ path: z.string().min(1).max(300) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Which track?' });
    if (!isCommitish(commit)) return reply.code(400).send({ error: 'Bad version id.' });
    if (!isTrackPath(query.data.path)) return reply.code(400).send({ error: 'Bad track path.' });

    const song = songOr404(slug, reply);
    if (!song) return;
    const repoDir = repoDirFor(dataDir, song.id);
    if ((await readTextAt(repoDir, commit, query.data.path)) === null) {
      return reply.code(404).send({ error: 'No such track in that version.' });
    }
    return { blame: await blameTrack(repoDir, commit, query.data.path) };
  });

  app.get('/api/formats', async () => ({ accepted: ACCEPTED_EXTENSIONS }));

  /** Liveness probe for the container healthcheck and uptime monitoring. */
  app.get('/api/health', async () => ({ ok: true }));

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPublicSong(row: SongRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    artist: row.artist,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    headCommit: row.head_commit,
    versionCount: row.version_count,
    trackCount: row.track_count,
    barCount: row.bar_count
  };
}

function serialiseCanonical(canonical: CanonicalSong) {
  return {
    songJson: canonical.songJson,
    structure: canonical.structure,
    tracks: canonical.tracks.map(track => ({
      path: track.path,
      name: track.name,
      index: track.index,
      lines: track.lines
    }))
  };
}

/** Commit ids only: never let a caller pass `--upload-pack` or a path to git. */
export function isCommitish(value: string): boolean {
  return /^[0-9a-f]{7,40}$/.test(value);
}

/** Track paths are generated by the canonicaliser and always take this shape. */
export function isTrackPath(value: string): boolean {
  return /^tracks\/[A-Za-z0-9._-]+\.tab$/.test(value) || value === 'structure.tab';
}

export function sanitiseFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'tab.gp';
}
