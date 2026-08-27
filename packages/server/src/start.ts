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
  const webRoot = resolve(env('GUITHUB_WEB_ROOT', join(here, '..', '..', 'web', 'dist')));

  const db = openDatabase(join(dataDir, 'guithub.db'));
  pruneExpiredSessions(db);

  const app = await buildApp({ db, dataDir, secureCookies, logger: true });

  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot });
    // The UI is a single-page app: any non-API path that is not a real file is a
    // client-side route, so hand back index.html and let the browser resolve it.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
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
