import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { relativeTime } from '../format.js';
import type { Song } from '../types.js';

export function SongsPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const result = await api.listSongs();
      setSongs(result.songs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the songs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1>Songs</h1>
          <p>Every song the band is working on, most recently changed first.</p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            New song
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p>Loading…</p>
      ) : songs.length === 0 ? (
        <div className="empty">
          <p>No songs yet.</p>
          <p>Create one, then upload a Guitar Pro file to start its history.</p>
        </div>
      ) : (
        <div className="song-grid">
          {songs.map(song => (
            <Link key={song.id} to={`/songs/${song.slug}`} className="song-card">
              <div className="song-card__title">{song.title}</div>
              {song.artist && <div className="song-card__artist">{song.artist}</div>}
              <div className="song-card__meta">
                {song.versionCount === 0
                  ? 'No versions yet'
                  : `${song.versionCount} version${song.versionCount === 1 ? '' : 's'} · ${song.trackCount} track${song.trackCount === 1 ? '' : 's'} · ${song.barCount} bars`}
                <br />
                Updated {relativeTime(song.updatedAt)}
              </div>
            </Link>
          ))}
        </div>
      )}

      {creating && (
        <NewSongModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function NewSongModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createSong(title, artist);
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the song.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={event => event.stopPropagation()}>
        <h2>New song</h2>
        <form onSubmit={submit}>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label htmlFor="artist">Artist (optional)</label>
            <input id="artist" value={artist} onChange={event => setArtist(event.target.value)} />
          </div>
          <div className="modal__actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
