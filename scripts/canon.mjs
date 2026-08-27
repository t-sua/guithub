import * as at from '@coderline/alphatab';
import { canonicalizeScore, trackFileContent } from '../packages/core/dist/index.js';
import { readFileSync } from 'node:fs';
const f = process.argv[2];
const bytes = new Uint8Array(readFileSync(f));
const score = f.endsWith('.atex')
  ? at.importer.ScoreLoader.loadAlphaTex(readFileSync(f, 'utf8'))
  : at.importer.ScoreLoader.loadScoreFromBytes(bytes);
const c = canonicalizeScore(score);
console.log('--- song.json ---'); console.log(c.songJson);
console.log('--- structure.tab ---'); console.log(c.structure.join('\n'));
for (const t of c.tracks) { console.log(`--- ${t.path} ---`); process.stdout.write(trackFileContent(t)); }
