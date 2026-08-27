import * as alphaTab from '@coderline/alphatab';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, '..', '..', '..', 'fixtures');

export function loadFixture(name: string): alphaTab.model.Score {
  const path = join(FIXTURES, name);
  if (name.endsWith('.atex')) {
    return alphaTab.importer.ScoreLoader.loadAlphaTex(readFileSync(path, 'utf8'));
  }
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(path)));
}

export function exportToGp(score: alphaTab.model.Score): Uint8Array {
  return new alphaTab.exporter.Gp7Exporter().export(score, null);
}

export function reimport(bytes: Uint8Array): alphaTab.model.Score {
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
}

export const GP_FIXTURES = [
  'song-a.gp',
  'song-a-note-changed.gp',
  'song-a-bar-inserted.gp',
  'song-b-complex.gp'
] as const;
