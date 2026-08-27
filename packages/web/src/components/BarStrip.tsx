import { useEffect, useRef, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';

export interface BarStripProps {
  /** Raw bytes of the tab file this bar comes from. */
  readonly data: ArrayBuffer | null;
  readonly trackIndex: number;
  /** Zero-based bar index. */
  readonly bar: number;
  /** `new` renders green, `old` renders red, following diff convention. */
  readonly tone: 'new' | 'old';
  readonly label?: string;
}

/**
 * Renders a single bar of a score in isolation, engraved rather than described.
 *
 * alphaTab's `startBar` / `barCount` display settings render exactly one bar with
 * its own clef and time signature, which is what lets a change be shown the way a
 * code diff shows one line: the new bar above, the old bar below.
 *
 * Rendering is deferred until the strip scrolls into view. A song with fifty changed
 * bars would otherwise build a hundred engraving engines on page load.
 */
export function BarStrip({ data, trackIndex, bar, tone, label }: BarStripProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '300px' }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !visible || !data) return;

    const api = new alphaTab.AlphaTabApi(mount, {
      core: {
        engine: 'svg',
        logLevel: alphaTab.LogLevel.Error,
        // alphaTab defaults to a path next to its bundle chunk (/assets/font/), but
        // the Vite plugin copies the fonts to the site root. Without this the font
        // 404s and alphaTab refuses to render at all.
        fontDirectory: `${import.meta.env.BASE_URL}font/`
      },
      display: {
        layoutMode: alphaTab.LayoutMode.Page,
        staveProfile: alphaTab.StaveProfile.ScoreTab,
        startBar: bar + 1,
        barCount: 1,
        justifyLastSystem: false,
        scale: 0.85
      },
      player: { enablePlayer: false }
    });

    // A one-bar strip is not a title page.
    for (const element of [
      alphaTab.NotationElement.ScoreTitle,
      alphaTab.NotationElement.ScoreSubTitle,
      alphaTab.NotationElement.ScoreArtist,
      alphaTab.NotationElement.ScoreAlbum,
      alphaTab.NotationElement.ScoreWords,
      alphaTab.NotationElement.ScoreMusic,
      alphaTab.NotationElement.ScoreWordsAndMusic,
      alphaTab.NotationElement.ScoreCopyright,
      alphaTab.NotationElement.GuitarTuning,
      alphaTab.NotationElement.TrackNames
    ]) {
      api.settings.notation.elements.set(element, false);
    }
    api.updateSettings();

    // alphaTab appends a "rendered by alphaTab" annotation to every score it lays
    // out, as its own SVG chunk. It belongs on the full score, where it appears
    // once; repeated under every changed bar it is only clutter, and alphaTab is
    // credited on the main score and in the README. The chunk can arrive after any
    // render event, so watch for it rather than trying to time a single sweep.
    const dropAnnotation = (): void => {
      for (const svg of Array.from(mount.querySelectorAll('svg'))) {
        if (svg.textContent?.includes('rendered by alphaTab')) svg.remove();
      }
    };
    const annotationWatcher = new MutationObserver(dropAnnotation);
    annotationWatcher.observe(mount, { childList: true, subtree: true });
    api.postRenderFinished.on(dropAnnotation);
    api.error.on(() => setFailed(true));

    try {
      api.load(new Uint8Array(data));
      const track = api.score?.tracks[trackIndex];
      if (track) api.renderTracks([track]);
    } catch {
      setFailed(true);
    }

    return () => {
      annotationWatcher.disconnect();
      api.destroy();
    };
  }, [visible, data, bar, trackIndex]);

  return (
    <div ref={hostRef} className={`strip strip--${tone}`}>
      <span className="strip__tag">{label ?? (tone === 'new' ? 'new' : 'old')}</span>
      <div className="strip__art">
        {failed ? (
          <p className="strip__error">This bar could not be rendered.</p>
        ) : (
          <div ref={mountRef} />
        )}
      </div>
    </div>
  );
}
