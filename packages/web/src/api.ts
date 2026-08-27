import type {
  BlameLine,
  CanonicalSong,
  Provenance,
  Song,
  SongDiff,
  User,
  Version
} from './types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Response had no JSON body; the status-derived message will do.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

export const api = {
  setup: () => request<{ needsFirstUser: boolean }>('/api/setup'),
  me: () => request<{ user: User | null }>('/api/me'),

  login: (username: string, password: string) =>
    request<{ user: User }>('/api/login', json({ username, password })),

  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),

  createUser: (input: {
    username: string;
    displayName: string;
    email: string;
    password: string;
    isAdmin?: boolean;
  }) => request<{ user: User }>('/api/users', json(input)),

  listUsers: () => request<{ users: User[] }>('/api/users'),

  listSongs: () => request<{ songs: Song[] }>('/api/songs'),

  createSong: (title: string, artist?: string) =>
    request<{ song: Song }>('/api/songs', json({ title, artist })),

  getSong: (slug: string) =>
    request<{ song: Song; versions: Version[] }>(`/api/songs/${encodeURIComponent(slug)}`),

  getVersion: (slug: string, commit: string) =>
    request<{ canonical: CanonicalSong; provenance: Provenance | null }>(
      `/api/songs/${encodeURIComponent(slug)}/versions/${commit}`
    ),

  getDiff: (slug: string, from: string, to: string) =>
    request<{ diff: SongDiff }>(
      `/api/songs/${encodeURIComponent(slug)}/diff?from=${from}&to=${to}`
    ),

  getBlame: (slug: string, commit: string, path: string) =>
    request<{ blame: BlameLine[] }>(
      `/api/songs/${encodeURIComponent(slug)}/blame/${commit}?path=${encodeURIComponent(path)}`
    ),

  fileUrl: (slug: string, commit: string) =>
    `/api/songs/${encodeURIComponent(slug)}/versions/${commit}/file`,

  async uploadVersion(slug: string, file: File, message: string): Promise<{ commit: string }> {
    const form = new FormData();
    form.append('message', message);
    form.append('file', file);
    const response = await fetch(`/api/songs/${encodeURIComponent(slug)}/versions`, {
      method: 'POST',
      credentials: 'same-origin',
      body: form
    });
    if (!response.ok) {
      let message = `Upload failed (${response.status})`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // Keep the status-derived message.
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as { commit: string };
  }
};
