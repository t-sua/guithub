import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as alphaTab from '@coderline/alphatab';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'guithub_theme';

interface ThemeState {
  readonly theme: Theme;
  readonly toggle: () => void;
  readonly setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeState>({
  theme: 'dark',
  toggle: () => undefined,
  setTheme: () => undefined
});

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // Storage can be unavailable (private windows, blocked site data).
  }
  if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // A viewer who cannot persist the choice still gets it for this session.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggle = useCallback(
    () => setThemeState(current => (current === 'dark' ? 'light' : 'dark')),
    []
  );

  const value = useMemo<ThemeState>(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}

// ---------------------------------------------------------------------------
// Score colours
// ---------------------------------------------------------------------------

function color(hex: string): alphaTab.model.Color {
  const value = hex.replace('#', '');
  return new alphaTab.model.Color(
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  );
}

/**
 * Colours alphaTab draws the score with.
 *
 * alphaTab engraves in black by default, which is unreadable on a dark page. Every
 * colour resource is set explicitly rather than relying on defaults, so nothing —
 * noteheads, stems, beams, slurs, clefs, tab numbers, staff lines, bar numbers —
 * is left black when the background is dark.
 *
 * `staffLine` deserves particular care: alphaTab paints ledger lines through
 * `BarSubElement.StandardNotationStaffLine`, the same resource as the staff itself,
 * so there is no way to colour them separately. A staff colour chosen to sit quietly
 * behind the notation also dims the ledger lines, and those carry pitch — a note
 * three ledger lines above the staff is unreadable without them. Printed engraving
 * draws staff lines in the same ink as the notes for exactly this reason, so these
 * stay close to the glyph colour. Every value here clears 3:1 against its sheet
 * (WCAG 1.4.11 for meaningful non-text graphics); the staff lines are near 10:1.
 */
const SCORE_COLORS: Record<Theme, Record<string, string>> = {
  dark: {
    mainGlyph: '#eceef6',
    secondaryGlyph: '#c0c7db',
    staffLine: '#c2c9dc',
    barSeparator: '#c2c9dc',
    barNumber: '#8fa9ff',
    scoreInfo: '#eceef6'
  },
  light: {
    mainGlyph: '#12131a',
    secondaryGlyph: '#3f4455',
    staffLine: '#4a5063',
    barSeparator: '#4a5063',
    barNumber: '#b3261e',
    scoreInfo: '#12131a'
  }
};

/** Applies the theme's colours to an alphaTab settings object, in place. */
export function applyScoreTheme(settings: alphaTab.Settings, theme: Theme): void {
  const palette = SCORE_COLORS[theme];
  const resources = settings.display.resources;
  resources.mainGlyphColor = color(palette['mainGlyph']!);
  resources.secondaryGlyphColor = color(palette['secondaryGlyph']!);
  resources.staffLineColor = color(palette['staffLine']!);
  resources.barSeparatorColor = color(palette['barSeparator']!);
  resources.barNumberColor = color(palette['barNumber']!);
  resources.scoreInfoColor = color(palette['scoreInfo']!);
}
