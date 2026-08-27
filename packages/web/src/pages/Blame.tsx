import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { TabViewer, type BarHighlight } from '../components/TabViewer.js';
import { authorColor, exactTime, relativeTime } from '../format.js';
import type { BlameLine, CanonicalSong, SongMetadata, Version } from '../types.js';

type Mode = 'author' | 'age';

/**
 * Who wrote each bar.
 *
 * The canonical track file holds exactly one line per bar, so `git blame` on it maps
 * line N to bar N directly — no heuristics, and git's own move detection keeps credit
 * with the person who wrote a part even after it is rearranged.
 */
export function BlamePage() {
  const { slug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [versions, setVersions] = useState<Version[]>([]);
  const [canonical, setCanonical] = useState<CanonicalSong | null>(null);
  const [blame, setBlame] = useState<BlameLine[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('author');
  const [trackPath, setTrackPath] = useState<string | null>(null);

  const commit = searchParams.get('v') ?? '';

  useEffect(() => {
    void api
      .getSong(slug)
      .then(result => {
        setVersions(result.versions);
        if (!commit && result.versions[0]) {
          setSearchParams({ v: result.versions[0].commit }, { replace: true });
        }
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load the song.')
      );
  }, [slug]);

  useEffect(() => {
    if (!commit) return;
    void api
      .getVersion(slug, commit)
      .then(result => {
        setCanonical(result.canonical);
        setTrackPath(current => current ?? result.canonical.tracks[0]?.path ?? null);
      })
      .catch(() => setCanonical(null));
  }, [slug, commit]);

  useEffect(() => {
    if (!commit || !trackPath) return;
    setLoading(true);
    void api
      .getBlame(slug, commit, trackPath)
      .then(result => {
        setBlame(result.blame);
        setError('');
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load blame.')
      )
      .finally(() => setLoading(false));
  }, [slug, commit, trackPath]);

  const metadata = useMemo<SongMetadata | null>(
    () => (canonical ? (JSON.parse(canonical.songJson) as SongMetadata) : null),
    [canonical]
  );

  const authors = useMemo(() => {
    const seen = new Map<string, number>();
    for (const line of blame) seen.set(line.authorName, (seen.get(line.authorName) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [blame]);

  const highlights = useMemo(() => {
    const map = new Map<number, BarHighlight>();
    if (blame.length === 0) return map;

    const times = blame.map(line => new Date(line.date).getTime()).filter(Number.isFinite);
    const oldest = Math.min(...times);
    const newest = Math.max(...times);
    const span = Math.max(1, newest - oldest);

    for (const line of blame) {
      const title = `Bar ${line.bar + 1} — ${line.authorName}, ${relativeTime(line.date)}\n${line.summary}`;
      if (mode === 'author') {
        map.set(line.bar, { color: authorColor(line.authorName, 0.3), title });
      } else {
        // Newer edits sit darker, so the parts of the song still in flux stand out.
        const age = (new Date(line.date).getTime() - oldest) / span;
        map.set(line.bar, { color: `rgba(124, 156, 255, ${0.08 + age * 0.34})`, title });
      }
    }
    return map;
  }, [blame, mode]);

  const trackIndex = useMemo(() => {
    const match = trackPath ? /^tracks\/(\d+)-/.exec(trackPath) : null;
    return match ? Number(match[1]) - 1 : null;
  }, [trackPath]);

  return (
    <div className="container container--wide">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link to="/">Songs</Link> / <Link to={`/songs/${slug}`}>{slug}</Link> / Blame
          </div>
          <h1>Who wrote what</h1>
          <p>Every bar coloured by the person who last changed it.</p>
        </div>
        <div className="page-header__actions">
          <button
            className={`btn ${mode === 'author' ? 'btn--primary' : ''}`}
            onClick={() => setMode('author')}
          >
            By author
          </button>
          <button
            className={`btn ${mode === 'age' ? 'btn--primary' : ''}`}
            onClick={() => setMode('age')}
          >
            By age
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {metadata && metadata.tracks.length > 1 && (
        <div className="tabs">
          {metadata.tracks.map(track => (
            <button
              key={track.path}
              className={`tab ${trackPath === track.path ? 'tab--active' : ''}`}
              onClick={() => setTrackPath(track.path)}
            >
              {track.name}
            </button>
          ))}
        </div>
      )}

      <div className="layout-sidebar">
        <div>
          {commit && (
            <TabViewer
              key={`${commit}-${trackPath}`}
              fileUrl={api.fileUrl(slug, commit)}
              trackIndex={trackIndex}
              highlights={highlights}
            />
          )}

          <div className="card" style={{ marginTop: 16 }}>
            <h2 className="panel-title">Bar by bar</h2>
            {loading ? (
              <p>Loading…</p>
            ) : (
              <table className="blame-table">
                <thead>
                  <tr>
                    <th className="blame-table__bar">Bar</th>
                    <th>Author</th>
                    <th>When</th>
                    <th>Version</th>
                    <th>Content</th>
                  </tr>
                </thead>
                <tbody>
                  {blame.map(line => (
                    <tr key={line.bar}>
                      <td className="blame-table__bar">{line.bar + 1}</td>
                      <td className="blame-table__author">
                        <span className="author-chip">
                          <span
                            className="author-chip__dot"
                            style={{ background: authorColor(line.authorName) }}
                          />
                          {line.authorName}
                        </span>
                      </td>
                      <td title={exactTime(line.date)}>{relativeTime(line.date)}</td>
                      <td>{line.summary}</td>
                      <td className="blame-table__content" title={line.content}>
                        {line.content}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <h2 className="panel-title">Contributors to this track</h2>
            <div className="version-list">
              {authors.map(([name, count]) => (
                <div key={name} className="version-row">
                  <span
                    className="author-chip__dot"
                    style={{ background: authorColor(name), width: 14, height: 14 }}
                  />
                  <span className="version-row__main">
                    <span className="version-row__message">{name}</span>
                    <span className="version-row__meta">
                      {count} bar{count === 1 ? '' : 's'} ·{' '}
                      {Math.round((count / Math.max(1, blame.length)) * 100)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2 className="panel-title">Version</h2>
            <div className="field" style={{ marginBottom: 0 }}>
              <select
                value={commit}
                onChange={event => setSearchParams({ v: event.target.value })}
              >
                {versions.map(version => (
                  <option key={version.commit} value={version.commit}>
                    {version.message} — {version.authorName}, {relativeTime(version.date)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
