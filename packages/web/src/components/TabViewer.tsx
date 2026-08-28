import { useEffect, useRef, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';
import { applyScoreTheme, useTheme } from '../theme.js';

/** How one bar should be marked up in the rendered score. */
export interface BarHighlight {
  readonly color: string;
  /** Outline colour, so a tint stays legible over dense notation. */
  readonly edge?: string;
  readonly label?: string;
  readonly title?: string;
}

export interface TabViewerProps {
  /** URL the original tab file is fetched from. */
  readonly fileUrl: string;
  /** Zero-based track index to render, or null for every track. */
  readonly trackIndex?: number | null;
  /** Zero-based bar index to highlight. */
  readonly highlights?: ReadonlyMap<number, BarHighlight>;
  readonly onBarClick?: (bar: number) => void;
  readonly showNotation?: boolean;
}

interface Overlay {
  readonly bar: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Renders a tab file with alphaTab and paints highlights over individual bars.
 *
 * The overlay positions come from alphaTab's own `boundsLookup`, which reports the
 * rectangle it drew each bar into. Highlighting therefore tracks the real engraving
 * at any zoom or width, rather than guessing where a bar landed.
 */
export function TabViewer({
  fileUrl,
  trackIndex = null,
  highlights,
  onBarClick,
  showNotation = true
}: TabViewerProps) {
  const { theme } = useTheme();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  // One alphaTab instance per mounted viewer, torn down on unmount.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

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
        staveProfile: showNotation
          ? alphaTab.StaveProfile.ScoreTab
          : alphaTab.StaveProfile.Tab,
        scale: 0.9
      },
      player: { enablePlayer: false }
    });
    applyScoreTheme(api.settings, theme);
    api.updateSettings();
    apiRef.current = api;

    const collectBounds = (): void => {
      const lookup = api.renderer.boundsLookup;
      if (!lookup) return;
      const found: Overlay[] = [];
      for (const system of lookup.staffSystems) {
        for (const bar of system.bars) {
          const bounds = bar.visualBounds;
          found.push({
            bar: bar.index,
            x: bounds.x,
            y: bounds.y,
            width: bounds.w,
            height: bounds.h
          });
        }
      }
      setOverlays(found);
    };

    api.renderFinished.on(collectBounds);
    api.error.on(error => {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Could not render this tab.');
    });
    api.scoreLoaded.on(() => setStatus('ready'));

    return () => {
      apiRef.current = null;
      api.destroy();
    };
  }, [showNotation]);

  // Load (or reload) the score whenever the source file changes.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setOverlays([]);

    void (async () => {
      try {
        const response = await fetch(fileUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Could not load the tab file (${response.status}).`);
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        apiRef.current?.load(new Uint8Array(buffer));
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Could not load the tab file.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  // A theme change only alters colours, so re-engrave the score already in memory
  // rather than tearing the instance down and fetching the file again.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    applyScoreTheme(api.settings, theme);
    api.updateSettings();
    if (api.score) api.render();
  }, [theme, status]);

  // Track selection is applied to the already-loaded score, avoiding a refetch.
  useEffect(() => {
    const api = apiRef.current;
    if (!api?.score) return;
    if (trackIndex === null) api.renderTracks(api.score.tracks);
    else {
      const track = api.score.tracks[trackIndex];
      if (track) api.renderTracks([track]);
    }
  }, [trackIndex, status]);

  return (
    <div className="tab-viewer">
      {status === 'loading' && <p className="tab-viewer__status">Rendering…</p>}
      {status === 'error' && (
        <p className="tab-viewer__status tab-viewer__status--error">{errorMessage}</p>
      )}
      <div className="tab-viewer__surface">
        <div ref={mountRef} className="tab-viewer__mount" />
        <div className="tab-viewer__overlays" aria-hidden="true">
          {overlays.map(overlay => {
            const highlight = highlights?.get(overlay.bar);
            if (!highlight) return null;
            return (
              <button
                type="button"
                key={`${overlay.bar}-${overlay.x}-${overlay.y}`}
                className="bar-highlight"
                title={highlight.title}
                onClick={onBarClick ? () => onBarClick(overlay.bar) : undefined}
                style={{
                  left: overlay.x,
                  top: overlay.y,
                  width: overlay.width,
                  height: overlay.height,
                  background: highlight.color,
                  boxShadow: highlight.edge ? `inset 0 0 0 1px ${highlight.edge}` : undefined,
                  cursor: onBarClick ? 'pointer' : 'default'
                }}
              >
                {highlight.label ? (
                  <span
                    className="bar-highlight__label"
                    style={highlight.edge ? { background: highlight.edge } : undefined}
                  >
                    {highlight.label}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
