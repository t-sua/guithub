import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { openDatabase } from './db.js';
import { pruneExpiredSessions } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export async function start(): Promise<void> {
  const dataDir = resolve(env('GUITHUB_DATA_DIR', './data'));
  const port = Number(env('GUITHUB_PORT', '8080'));
  const host = env('GUITHUB_HOST', '127.0.0.1');
  const secureCookies = env('GUITHUB_SECURE_COOKIES', 'false') === 'true';
  const trustProxy = env('GUITHUB_TRUST_PROXY', 'false') === 'true';
  const publicUrl = env('GUITHUB_PUBLIC_URL', '');
  const webRoot = resolve(env('GUITHUB_WEB_ROOT', join(here, '..', '..', 'web', 'dist')));

  const db = openDatabase(join(dataDir, 'guithub.db'));
  pruneExpiredSessions(db);

  const app = await buildApp({
    db,
    dataDir,
    secureCookies,
    trustProxy,
    ...(publicUrl ? { publicUrl } : {}),
    logger: true
  });

  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    // The UI is a single-page app: a non-API path that is not a real file is a
    // client-side route, so hand back index.html and let the browser resolve it.
    //
    // A request that looks like a file is deliberately excluded. Answering a missing
    // font or script with HTML turns a plain 404 into a baffling downstream error —
    // a missing Bravura font once surfaced as "OTS parsing error: invalid
    // sfntVersion", which is the parser choking on "<!DOCTYPE".
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      const looksLikeAsset = /\.[a-z0-9]{2,5}$/i.test(path);
      if (request.url.startsWith('/api/') || looksLikeAsset) {
        return reply.code(404).send({ error: 'Not found.' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`web assets not found at ${webRoot}; serving the API only`);
  }

  // Expired sessions are cleared hourly. `unref` keeps this timer from holding the
  // process open during shutdown.
  const pruneTimer = setInterval(() => pruneExpiredSessions(db), 60 * 60 * 1000);
  pruneTimer.unref();

  const close = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  await app.listen({ port, host });
  app.log.info(`GuitHub data directory: ${dataDir}`);
}
