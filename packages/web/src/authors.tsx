import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.js';
import { authorColor } from './format.js';

/**
 * A colour per person, distinct by construction.
 *
 * Hashing a name to a hue is stable but not distinguishable: with a handful of
 * band members two people land on neighbouring hues often enough that a blame view
 * becomes unreadable. Instead every member is assigned a slot in a fixed palette of
 * well-separated colours, ordered by username so the assignment is the same on every
 * page and every session. Anyone not in the member list (an old commit by someone
 * since removed) falls back to the hash.
 */
const PALETTE = [
  '#4c9aff', // blue
  '#f0883e', // orange
  '#3fb950', // green
  '#d2a8ff', // violet
  '#ff7b9c', // pink
  '#39c5cf', // cyan
  '#e3b341', // gold
  '#f85149', // red
  '#a5d6ff', // pale blue
  '#7ee787' // pale green
] as const;

interface AuthorColors {
  readonly colorFor: (name: string) => string;
}

const AuthorColorContext = createContext<AuthorColors>({ colorFor: authorColor });

export function AuthorColorProvider({ children }: { children: ReactNode }) {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    void api
      .listUsers()
      .then(result =>
        setNames(
          [...result.users]
            .sort((a, b) => a.username.localeCompare(b.username))
            .map(user => user.displayName)
        )
      )
      .catch(() => setNames([]));
  }, []);

  const value = useMemo<AuthorColors>(() => {
    const assigned = new Map<string, string>();
    names.forEach((name, index) => {
      const color = PALETTE[index % PALETTE.length];
      if (color) assigned.set(name, color);
    });
    return { colorFor: name => assigned.get(name) ?? authorColor(name) };
  }, [names]);

  return <AuthorColorContext.Provider value={value}>{children}</AuthorColorContext.Provider>;
}

export function useAuthorColor(): (name: string) => string {
  return useContext(AuthorColorContext).colorFor;
}

/** Applies an alpha channel to a palette colour for use as a bar tint. */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
      .toString(16)
      .padStart(2, '0');
    return `${color}${value}`;
  }
  // hsl(...) from the hash fallback already carries its own alpha slot.
  return color.replace(/\/\s*[\d.]+\s*\)$/, `/ ${alpha})`);
}
