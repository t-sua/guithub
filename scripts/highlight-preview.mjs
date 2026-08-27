// Renders a version with diff highlights baked in, exactly as the browser overlay
// positions them, so the result can be eyeballed without a browser.
import * as at from '@coderline/alphatab';
import { canonicalizeScore, diffSongs } from '../packages/core/dist/index.js';
import { readFileSync, writeFileSync } from 'node:fs';

const [before, after, out] = process.argv.slice(2);
const load = f => at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(f)));

const diff = diffSongs(canonicalizeScore(load(before)), canonicalizeScore(load(after)));
const track = diff.tracks.find(t => t.status !== 'unchanged');
const colors = { added: '#4ec9a0', removed: '#ff6b7a', modified: '#ffb454', moved: '#c792ea' };
const marks = new Map();
for (const bar of track?.bars ?? []) {
  if (bar.afterIndex !== null) marks.set(bar.afterIndex, { kind: bar.kind, summary: bar.summary });
}
console.log(`highlighting ${marks.size} bar(s) in "${track?.name}"`);

const score = load(after);
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
  const rects = [];
  for (const system of renderer.boundsLookup.staffSystems) {
    for (const bar of system.bars) {
      const mark = marks.get(bar.index);
      if (!mark) continue;
      const b = bar.visualBounds;
      rects.push(`<div class="hl" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${colors[mark.kind]}55">`
        + `<span>bar ${bar.index + 1}: ${mark.summary}</span></div>`);
    }
  }
  // alphaTab emits one SVG per staff system; the browser appends them as siblings
  // and bounds are global to the container. Reproduce that exact structure.
  const body = chunks.filter(c => typeof c === 'string').join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #fff; font-family: system-ui, sans-serif; }
    .surface { position: relative; display: inline-block; }
    .surface svg { display: block; }
    .hl { position: absolute; border-radius: 3px; mix-blend-mode: multiply; }
    .hl span { position: absolute; top: -7px; left: 2px; font-size: 10px; font-weight: 700;
               color: #1a1c26; background: rgba(255,255,255,.85); padding: 0 3px; border-radius: 2px;
               white-space: nowrap; }
  </style></head><body><div class="surface">${body}${rects.join('')}</div></body></html>`;
  writeFileSync(out, html);
  console.log(`wrote ${out} (${html.length} bytes, ${rects.length} highlights)`);
});
renderer.renderScore(score, [0]);
