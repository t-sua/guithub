/**
 * Renders a mock-up of the unified diff view so the visual design can be checked
 * without a browser: the full "after" score with changed bars tinted, then one card
 * per change showing the new bar in green above the old bar in red.
 *
 * Usage: node scripts/diff-preview.mjs <before.gp> <after.gp> <out.html>
 */
import * as at from '@coderline/alphatab';
import { canonicalizeScore, diffSongs } from '../packages/core/dist/index.js';
import { readFileSync, writeFileSync } from 'node:fs';

const [beforeFile, afterFile, out] = process.argv.slice(2);
const load = f => at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(f)));

const FONT_DIR = 'node_modules/@coderline/alphatab/dist/font/';

function baseSettings({ startBar = 1, barCount = -1, scale = 1, bare = false } = {}) {
  const s = new at.Settings();
  s.core.engine = 'svg';
  s.core.enableLazyLoading = false;
  s.core.fontDirectory = FONT_DIR;
  s.display.staveProfile = at.StaveProfile.ScoreTab;
  s.display.layoutMode = at.LayoutMode.Page;
  s.display.startBar = startBar;
  s.display.barCount = barCount;
  s.display.scale = scale;
  if (bare) {
    // A bar strip shows one bar, not a title page.
    for (const el of [
      at.NotationElement.ScoreTitle,
      at.NotationElement.ScoreSubTitle,
      at.NotationElement.ScoreArtist,
      at.NotationElement.ScoreAlbum,
      at.NotationElement.ScoreWords,
      at.NotationElement.ScoreMusic,
      at.NotationElement.ScoreWordsAndMusic,
      at.NotationElement.ScoreCopyright,
      at.NotationElement.GuitarTuning,
      at.NotationElement.TrackNames
    ]) {
      s.notation.elements.set(el, false);
    }
  }
  return s;
}

function render(score, trackIndex, settings, width) {
  return new Promise(resolve => {
    const renderer = new at.rendering.ScoreRenderer(settings);
    renderer.width = width;
    const chunks = [];
    renderer.partialRenderFinished.on(r => chunks.push(r.renderResult));
    renderer.renderFinished.on(() => {
      const bars = [];
      for (const system of renderer.boundsLookup?.staffSystems ?? []) {
        for (const bar of system.bars) bars.push({ index: bar.index, b: bar.visualBounds });
      }
      resolve({ svg: chunks.filter(c => typeof c === 'string').join('\n'), bars });
    });
    renderer.renderScore(score, [trackIndex]);
  });
}

const diff = diffSongs(canonicalizeScore(load(beforeFile)), canonicalizeScore(load(afterFile)));
const track = diff.tracks.find(t => t.status !== 'unchanged');
if (!track) {
  console.log('no changed track');
  process.exit(0);
}
const trackIndex = Number(/^tracks\/(\d+)-/.exec(track.path)[1]) - 1;
console.log(`track "${track.name}" (index ${trackIndex}) — ${track.bars.length} change(s)`);

const beforeScore = load(beforeFile);
const afterScore = load(afterFile);

// Main continuous score: the "after" version, changed bars tinted.
const main = await render(afterScore, trackIndex, baseSettings(), 880);
const tint = { added: '#3fb950', modified: '#3fb950', moved: '#a371f7', removed: '#f85149' };
const overlays = main.bars
  .filter(({ index }) => track.bars.some(c => c.afterIndex === index))
  .map(({ index, b }) => {
    const change = track.bars.find(c => c.afterIndex === index);
    return `<div class="hl" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${tint[change.kind]}2e;box-shadow:inset 0 0 0 1px ${tint[change.kind]}66">
      <span class="hl__tag" style="background:${tint[change.kind]}">bar ${index + 1}</span></div>`;
  })
  .join('');

// One card per change: new bar above old bar.
const cards = [];
for (const change of track.bars) {
  const parts = [];
  if (change.afterIndex !== null) {
    const r = await render(
      afterScore,
      trackIndex,
      baseSettings({ startBar: change.afterIndex + 1, barCount: 1, scale: 0.95, bare: true }),
      760
    );
    parts.push(`<div class="strip strip--new"><span class="strip__tag">new</span><div class="strip__art">${r.svg}</div></div>`);
  }
  if (change.beforeIndex !== null && change.kind !== 'added') {
    const r = await render(
      beforeScore,
      trackIndex,
      baseSettings({ startBar: change.beforeIndex + 1, barCount: 1, scale: 0.95, bare: true }),
      760
    );
    parts.push(`<div class="strip strip--old"><span class="strip__tag">old</span><div class="strip__art">${r.svg}</div></div>`);
  }
  const details = change.voices
    .flatMap(v => v.beats.map(b => `<li>Beat ${(b.afterIndex ?? b.beforeIndex) + 1}: ${b.description}</li>`))
    .join('');
  cards.push(`<div class="card card--${change.kind}">
    <div class="card__head"><span class="card__bar">Bar ${(change.afterIndex ?? change.beforeIndex) + 1}</span>
      <span class="card__kind card__kind--${change.kind}">${change.kind}</span>
      <span class="card__summary">${change.summary}</span></div>
    ${parts.join('')}
    ${details ? `<ul class="card__details">${details}</ul>` : ''}
  </div>`);
}

const font = readFileSync(`${FONT_DIR}Bravura.woff2`).toString('base64');

writeFileSync(
  out,
  `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: alphaTab; src: url(data:font/woff2;base64,${font}) format('woff2'); font-display: block; }
/* alphaTab tags every music glyph with class="at" and expects its stylesheet to
   point that at the SMuFL font. Reproduce that here. */
.at, .at text { font-family: alphaTab; }
:root { --bg:#12131a; --raised:#1a1c26; --border:#2c3040; --text:#e6e8f0; --dim:#9aa0b4; --faint:#6b7188;
        --new:#3fb950; --old:#f85149; --moved:#a371f7; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,sans-serif; padding:24px; }
h1 { font-size:22px; margin:0 0 4px; letter-spacing:-.02em; }
.sub { color:var(--dim); margin:0 0 20px; font-size:14px; }
.panel-title { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--faint);
               font-weight:600; margin:0 0 10px; }
.score { position:relative; background:#fff; border-radius:8px; padding:8px; display:inline-block; margin-bottom:28px; }
.score svg { display:block; }
.hl { position:absolute; border-radius:3px; }
.hl__tag { position:absolute; top:-9px; left:-1px; font-size:9px; font-weight:700; color:#08130a;
           padding:1px 5px; border-radius:3px; white-space:nowrap; }
.card { background:var(--raised); border:1px solid var(--border); border-left-width:3px; border-radius:8px;
        padding:14px; margin-bottom:12px; }
.card--added, .card--modified { border-left-color:var(--new); }
.card--removed { border-left-color:var(--old); }
.card--moved { border-left-color:var(--moved); }
.card__head { display:flex; align-items:baseline; gap:10px; margin-bottom:12px; flex-wrap:wrap; }
.card__bar { font-weight:650; }
.card__kind { font-size:10px; text-transform:uppercase; letter-spacing:.05em; font-weight:700;
              padding:2px 7px; border-radius:20px; }
.card__kind--added, .card__kind--modified { background:rgba(63,185,80,.15); color:var(--new); }
.card__kind--removed { background:rgba(248,81,73,.15); color:var(--old); }
.card__kind--moved { background:rgba(163,113,247,.15); color:var(--moved); }
.card__summary { color:var(--dim); font-size:14px; }
.strip { position:relative; border-radius:6px; padding:6px 6px 6px 46px; margin-bottom:8px; overflow-x:auto; }
.strip--new { background:rgba(63,185,80,.13); box-shadow:inset 0 0 0 1px rgba(63,185,80,.35); }
.strip--old { background:rgba(248,81,73,.13); box-shadow:inset 0 0 0 1px rgba(248,81,73,.35); }
.strip__tag { position:absolute; left:8px; top:50%; transform:translateY(-50%); font-size:10px; font-weight:700;
              text-transform:uppercase; letter-spacing:.04em; }
.strip--new .strip__tag { color:var(--new); }
.strip--old .strip__tag { color:var(--old); }
.strip__art { background:#fff; border-radius:4px; display:inline-block; padding:2px 6px; }
.strip__art svg { display:block; }
.card__details { margin:10px 0 0; padding-left:18px; color:var(--dim); font-size:13px; }
.card__details li { margin:2px 0; }
</style></head><body>
<h1>${track.name}</h1>
<p class="sub">+${track.barsAdded} added · −${track.barsRemoved} removed · ~${track.barsModified} changed · ${track.barsMoved} moved</p>
<h2 class="panel-title">Score — changed bars highlighted</h2>
<div class="score">${main.svg}${overlays}</div>
<h2 class="panel-title">Changes</h2>
${cards.join('')}
</body></html>`
);
console.log(`wrote ${out}`);
