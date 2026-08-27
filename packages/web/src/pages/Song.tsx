import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { TabViewer } from '../components/TabViewer.js';
import { authorColor, exactTime, formatTuning, initials, relativeTime } from '../format.js';
import type { CanonicalSong, Song, SongMetadata, Version } from '../types.js';

export function SongPage() {
  const { slug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [song, setSong] = useState<Song | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [canonical, setCanonical] = useState<CanonicalSong | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [trackIndex, setTrackIndex] = useState<number | null>(null);

  const selected = searchParams.get('v') ?? versions[0]?.commit ?? null;

  const load = useCallback(async () => {
    try {
      const result = await api.getSong(slug);
      setSong(result.song);
      setVersions(result.versions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the song.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setCanonical(null);
      return;
    }
    let cancelled = false;
    void api
      .getVersion(slug, selected)
      .then(result => {
        if (!cancelled) setCanonical(result.canonical);
      })
      .catch(() => {
        if (!cancelled) setCanonical(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, selected]);

  const metadata = useMemo<SongMetadata | null>(
    () => (canonical ? (JSON.parse(canonical.songJson) as SongMetadata) : null),
    [canonical]
  );

  const selectVersion = (commit: string) => {
    setSearchParams(commit === versions[0]?.commit ? {} : { v: commit });
  };

  if (loading) return <div className="container">Loading…</div>;
  if (error) return <div className="container"><div className="error-banner">{error}</div></div>;
  if (!song) return null;

  const previous = selected ? versions[versions.findIndex(v => v.commit === selected) + 1] : undefined;

  return (
    <div className="container container--wide">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link to="/">Songs</Link> / {song.title}
          </div>
          <h1>{song.title}</h1>
          <p>
            {song.artist && `${song.artist} · `}
            {song.versionCount} version{song.versionCount === 1 ? '' : 's'}
            {metadata && ` · ${metadata.tempo} bpm · ${metadata.barCount} bars`}
          </p>
        </div>
        <div className="page-header__actions">
          {previous && selected && (
            <Link className="btn" to={`/songs/${slug}/compare?from=${previous.commit}&to=${selected}`}>
              Compare with previous
            </Link>
          )}
          {selected && (
            <Link className="btn" to={`/songs/${slug}/blame?v=${selected}`}>
              Blame
            </Link>
          )}
          {selected && (
            <a className="btn" href={api.fileUrl(slug, selected)}>
              Download
            </a>
          )}
          <button className="btn btn--primary" onClick={() => setUploading(true)}>
            Upload version
          </button>
        </div>
      </div>

      {versions.length === 0 ? (
        <div className="empty">
          <p>This song has no versions yet.</p>
          <p>Upload a Guitar Pro file (.gp, .gp3–.gp5, .gpx) or MusicXML to start its history.</p>
          <button className="btn btn--primary" onClick={() => setUploading(true)}>
            Upload the first version
          </button>
        </div>
      ) : (
        <div className="layout-sidebar">
          <div>
            {metadata && metadata.tracks.length > 1 && (
              <div className="tabs">
                <button
                  className={`tab ${trackIndex === null ? 'tab--active' : ''}`}
                  onClick={() => setTrackIndex(null)}
                >
                  All tracks
                </button>
                {metadata.tracks.map(track => (
                  <button
                    key={track.index}
                    className={`tab ${trackIndex === track.index ? 'tab--active' : ''}`}
                    onClick={() => setTrackIndex(track.index)}
                  >
                    {track.name}
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <TabViewer
                key={selected}
                fileUrl={api.fileUrl(slug, selected)}
                trackIndex={trackIndex}
              />
            )}
            {metadata && (
              <div className="card" style={{ marginTop: 16 }}>
                <h2 className="panel-title">Tracks</h2>
                <table className="blame-table">
                  <thead>
                    <tr>
                      <th>Track</th>
                      <th>Tuning</th>
                      <th>Bars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metadata.tracks.map(track => (
                      <tr key={track.index}>
                        <td>{track.name}</td>
                        <td className="mono">
                          {track.isPercussion ? 'percussion' : formatTuning(track.tuning)}
                          {track.capo > 0 && ` · capo ${track.capo}`}
                        </td>
                        <td>{track.barCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="panel-title">History</h2>
            <div className="version-list">
              {versions.map((version, index) => (
                <button
                  key={version.commit}
                  className={`version-row ${version.commit === selected ? 'version-row--active' : ''}`}
                  onClick={() => selectVersion(version.commit)}
                >
                  <span
                    className="avatar"
                    style={{ background: authorColor(version.authorName) }}
                    title={version.authorName}
                  >
                    {initials(version.authorName)}
                  </span>
                  <span className="version-row__main">
                    <span className="version-row__message">{version.message}</span>
                    <span className="version-row__meta">
                      {version.authorName} · {relativeTime(version.date)}
                      {index === 0 && ' · latest'}
                    </span>
                  </span>
                  <span className="version-row__hash" title={exactTime(version.date)}>
                    {version.shortCommit}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {uploading && (
        <UploadModal
          slug={slug}
          onClose={() => setUploading(false)}
          onUploaded={commit => {
            setUploading(false);
            setSearchParams({});
            void load().then(() => selectVersion(commit));
          }}
        />
      )}
    </div>
  );
}

function UploadModal({
  slug,
  onClose,
  onUploaded
}: {
  slug: string;
  onClose: () => void;
  onUploaded: (commit: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.uploadVersion(slug, file, message);
      onUploaded(result.commit);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={event => event.stopPropagation()}>
        <h2>Upload a version</h2>
        <form onSubmit={submit}>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label>Tab file</label>
            <label className="file-drop">
              <input
                ref={inputRef}
                type="file"
                accept=".gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml,.mxl,.cap,.capx"
                onChange={event => setFile(event.target.files?.[0] ?? null)}
              />
              {file ? file.name : 'Choose a Guitar Pro or MusicXML file'}
            </label>
          </div>
          <div className="field">
            <label htmlFor="message">What changed?</label>
            <input
              id="message"
              value={message}
              onChange={event => setMessage(event.target.value)}
              placeholder="Rewrote the bridge"
            />
          </div>
          <div className="modal__actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy || !file}>
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
