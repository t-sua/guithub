/**
 * Entry point.
 *
 * This file checks the Node version and nothing else, then loads the real server
 * with a dynamic import. That ordering is deliberate: static imports are hoisted and
 * run before any code in the module body, so a native dependency built for a
 * different Node ABI would segfault before a check placed alongside them could ever
 * report the problem. Loading the server only after the check keeps the failure
 * legible.
 */

const MINIMUM_NODE_MAJOR = 20;

const major = Number(process.versions.node.split('.')[0]);
if (Number.isFinite(major) && major < MINIMUM_NODE_MAJOR) {
  console.error(
    `GuitHub needs Node.js ${MINIMUM_NODE_MAJOR} or newer (Node 22 LTS recommended); this is Node ${process.versions.node}.`
  );
  console.error('Upgrade Node, then run: npm install && npm run build');
  process.exit(1);
}

const { start } = await import('./start.js');

start().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
