/**
 * Creates the first administrator, from a shell on the server.
 *
 * Account creation deliberately has no unauthenticated HTTP path: an endpoint that
 * lets the first caller become admin is a land grab on a public URL. Bootstrapping
 * therefore requires access to the machine itself.
 *
 *   docker compose exec guithub npm run create-admin -- \
 *     --username alice --name "Alice Reyes" --email alice@example.com
 *
 * The password is read from the GUITHUB_ADMIN_PASSWORD environment variable, or
 * generated and printed if that is unset.
 */
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { openDatabase } from '../db.js';
import { countUsers, createUser, findUserByUsername } from '../auth.js';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(`create-admin: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const username = flag('username');
  const displayName = flag('name');
  const email = flag('email');

  if (!username || !displayName || !email) {
    fail('usage: create-admin --username <name> --name "<display name>" --email <address>');
  }
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(username)) {
    fail('username must be 2-32 characters: letters, numbers, dashes or underscores');
  }

  const dataDir = resolve(process.env['GUITHUB_DATA_DIR'] ?? './data');
  const db = openDatabase(join(dataDir, 'guithub.db'));

  try {
    if (findUserByUsername(db, username)) fail(`a user named "${username}" already exists`);

    const generated = process.env['GUITHUB_ADMIN_PASSWORD'] === undefined;
    const password = process.env['GUITHUB_ADMIN_PASSWORD'] ?? randomBytes(12).toString('base64url');
    if (password.length < 8) fail('GUITHUB_ADMIN_PASSWORD must be at least 8 characters');

    const user = await createUser(db, { username, displayName, email, password, isAdmin: true });

    console.log(`Created admin "${user.username}" (${user.displayName}).`);
    if (generated) {
      console.log(`\n  password: ${password}\n`);
      console.log('This is shown once. Save it now, then sign in and invite the others.');
    }
    console.log(`Accounts on this instance: ${countUsers(db)}`);
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
