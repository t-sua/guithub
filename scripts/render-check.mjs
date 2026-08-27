// Verifies the assumption the diff and blame overlays depend on: after rendering,
// alphaTab reports a bounding box per bar, keyed by masterbar index.
import * as at from '@coderline/alphatab';
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const score = at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(file)));

const settings = new at.Settings();
settings.core.engine = 'svg';
settings.core.enableLazyLoading = false;
settings.display.layoutMode = at.LayoutMode.Page;
settings.display.staveProfile = at.StaveProfile.ScoreTab;
settings.core.fontDirectory = 'node_modules/@coderline/alphatab/dist/font/';

const renderer = new at.rendering.ScoreRenderer(settings);
renderer.width = 900;

const chunks = [];
renderer.partialRenderFinished.on(r => chunks.push(r.renderResult));
renderer.renderFinished.on(() => {
  const lookup = renderer.boundsLookup;
  if (!lookup) { console.log('NO BOUNDS LOOKUP'); process.exit(1); }
  let bars = 0;
  const seen = [];
  for (const system of lookup.staffSystems) {
    for (const bar of system.bars) {
      bars++;
      seen.push({ index: bar.index, x: Math.round(bar.visualBounds.x), y: Math.round(bar.visualBounds.y), w: Math.round(bar.visualBounds.w), h: Math.round(bar.visualBounds.h) });
    }
  }
  console.log(`staffSystems=${lookup.staffSystems.length} barBounds=${bars} masterBars=${score.masterBars.length}`);
  for (const b of seen) console.log(`  bar index=${b.index}  x=${b.x} y=${b.y} w=${b.w} h=${b.h}`);
  const svg = chunks.filter(c => typeof c === 'string').join('');
  if (svg) { writeFileSync('/tmp/claude-1000/-home-tsua/6a55d1a6-bd13-45f6-ad4b-94aada78c405/scratchpad/render.svg', svg); console.log(`svg written: ${svg.length} bytes`); }
});

renderer.renderScore(score, [0]);
