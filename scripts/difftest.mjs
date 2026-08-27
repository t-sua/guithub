import * as at from '@coderline/alphatab';
import { canonicalizeScore, diffSongs } from '../packages/core/dist/index.js';
import { readFileSync } from 'node:fs';
const load = f => f.endsWith('.atex')
  ? at.importer.ScoreLoader.loadAlphaTex(readFileSync(f, 'utf8'))
  : at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(f)));
const a = canonicalizeScore(load(process.argv[2]));
const b = canonicalizeScore(load(process.argv[3]));
const d = diffSongs(a, b);
if (d.metadata.length) { console.log('METADATA:'); for (const m of d.metadata) console.log(`  ${m.field}: "${m.before}" -> "${m.after}"`); }
if (d.structure.length) { console.log('STRUCTURE:'); for (const b of d.structure) console.log(`  ${b.kind.toUpperCase().padEnd(8)} bar ${(b.afterIndex ?? b.beforeIndex)+1}: ${b.summary}`); }
for (const t of d.tracks) {
  if (t.status === 'unchanged') { console.log(`\n[${t.name}] unchanged`); continue; }
  console.log(`\n[${t.name}] ${t.status}  +${t.barsAdded} -${t.barsRemoved} ~${t.barsModified} moved:${t.barsMoved}`);
  for (const bar of t.bars) {
    const pos = bar.afterIndex !== null ? `bar ${bar.afterIndex+1}` : `bar ${bar.beforeIndex+1} (old)`;
    console.log(`  ${bar.kind.toUpperCase().padEnd(8)} ${pos}: ${bar.summary}`);
    for (const v of bar.voices) for (const beat of v.beats) console.log(`      beat ${(beat.afterIndex ?? beat.beforeIndex)+1}: ${beat.description}`);
  }
}
