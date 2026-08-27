import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { TabViewer, type BarHighlight } from '../components/TabViewer.js';
import { relativeTime } from '../format.js';
import type { BarChange, ChangeKind, SongDiff, TrackDiff, Version } from '../types.js';

const KIND_COLORS: Record<ChangeKind, string> = {
  added: 'rgba(78, 201, 160, 0.32)',
  removed: 'rgba(255, 107, 122, 0.32)',
  modified: 'rgba(255, 180, 84, 0.34)',
  moved: 'rgba(199, 146, 234, 0.32)'
};

const KIND_LABELS: Record<ChangeKind, string> = {
  added: 'added',
  removed: 'removed',
  modified: 'changed',
  moved: 'moved'
};

export function ComparePage() {
  const { slug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [versions, setVersions] = useState<Version[]>([]);
  const [diff, setDiff] = useState<SongDiff | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTrack, setActiveTrack] = useState(0);

  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  useEffect(() => {
    void api
      .getSong(slug)
      .then(result => {
        setVersions(result.versions);
        // Default to comparing the two most recent versions.
        if ((!from || !to) && result.versions.length >= 2) {
          setSearchParams(
            { from: result.versions[1]!.commit, to: result.versions[0]!.commit },
            { replace: true }
          );
        }
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Could not load the song.');
      });
  }, [slug]);

  useEffect(() => {
    if (!from || !to) return;
    setLoading(true);
    void api
      .getDiff(slug, from, to)
      .then(result => {
        setDiff(result.diff);
        setError('');
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Could not compare those versions.');
      })
      .finally(() => setLoading(false));
  }, [slug, from, to]);

  const changedTracks = useMemo(
    () => diff?.tracks.filter(track => track.status !== 'unchanged') ?? [],
    [diff]
  );
  const track: TrackDiff | undefined = changedTracks[activeTrack];

  const { beforeHighlights, afterHighlights } = useMemo(() => {
    const before = new Map<number, BarHighlight>();
    const after = new Map<number, BarHighlight>();
    for (const bar of track?.bars ?? []) {
      const highlight: BarHighlight = {
        color: KIND_COLORS[bar.kind],
        title: `Bar ${(bar.afterIndex ?? bar.beforeIndex ?? 0) + 1}: ${bar.summary}`
      };
      if (bar.beforeIndex !== null) before.set(bar.beforeIndex, highlight);
      if (bar.afterIndex !== null) after.set(bar.afterIndex, highlight);
    }
    return { beforeHighlights: before, afterHighlights: after };
  }, [track]);

  const fromVersion = versions.find(version => version.commit === from);
  const toVersion = versions.find(version => version.commit === to);

  return (
    <div className="container container--wide">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link to="/">Songs</Link> / <Link to={`/songs/${slug}`}>{slug}</Link> / Compare
          </div>
          <h1>Compare versions</h1>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
            <label htmlFor="from">From</label>
            <select
              id="from"
              value={from}
              onChange={event => setSearchParams({ from: event.target.value, to })}
            >
              {versions.map(version => (
                <option key={version.commit} value={version.commit}>
                  {version.message} — {version.authorName}, {relativeTime(version.date)}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
            <label htmlFor="to">To</label>
            <select
              id="to"
              value={to}
              onChange={event => setSearchParams({ from, to: event.target.value })}
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

      {error && <div className="error-banner">{error}</div>}
      {loading && <p>Comparing…</p>}

      {diff && !loading && (
        <>
          {!diff.hasChanges && (
            <div className="notice">These two versions are musically identical.</div>
          )}

          {diff.metadata.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 className="panel-title">Song settings</h2>
              <ul className="change__details" style={{ paddingLeft: 18 }}>
                {diff.metadata.map(change => (
                  <li key={change.field}>
                    <strong>{change.field}</strong>: {change.before || '(empty)'} →{' '}
                    {change.after || '(empty)'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {diff.structure.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h2 className="panel-title">Structure</h2>
              <div className="change-list">
                {diff.structure.map((bar, index) => (
                  <ChangeCard key={index} bar={bar} />
                ))}
              </div>
            </div>
          )}

          {changedTracks.length > 0 && (
            <>
              <div className="tabs">
                {changedTracks.map((candidate, index) => (
                  <button
                    key={candidate.path ?? candidate.name}
                    className={`tab ${index === activeTrack ? 'tab--active' : ''}`}
                    onClick={() => setActiveTrack(index)}
                  >
                    {candidate.name}
                    <span className="version-row__meta">
                      {' '}
                      ({candidate.barsAdded + candidate.barsRemoved + candidate.barsModified + candidate.barsMoved})
                    </span>
                  </button>
                ))}
              </div>

              {track && (
                <>
                  <div className="track-summary">
                    <span className="track-summary__name">{track.name}</span>
                    {track.barsAdded > 0 && <span className="stat stat--added">+{track.barsAdded} bars</span>}
                    {track.barsRemoved > 0 && <span className="stat stat--removed">−{track.barsRemoved} bars</span>}
                    {track.barsModified > 0 && <span className="stat stat--modified">~{track.barsModified} changed</span>}
                    {track.barsMoved > 0 && <span className="stat stat--moved">⇄{track.barsMoved} moved</span>}
                    <div style={{ marginLeft: 'auto' }} className="legend">
                      {(['added', 'removed', 'modified', 'moved'] as const).map(kind => (
                        <span key={kind} className="legend__item">
                          <span className="legend__swatch" style={{ background: KIND_COLORS[kind] }} />
                          {KIND_LABELS[kind]}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="split">
                    <div>
                      <h2 className="panel-title">
                        Before — {fromVersion?.message ?? 'earlier version'}
                      </h2>
                      {from && (
                        <TabViewer
                          key={`before-${from}-${track.name}`}
                          fileUrl={api.fileUrl(slug, from)}
                          trackIndex={trackIndexFor(track, 'before')}
                          highlights={beforeHighlights}
                        />
                      )}
                    </div>
                    <div>
                      <h2 className="panel-title">
                        After — {toVersion?.message ?? 'later version'}
                      </h2>
                      {to && (
                        <TabViewer
                          key={`after-${to}-${track.name}`}
                          fileUrl={api.fileUrl(slug, to)}
                          trackIndex={trackIndexFor(track, 'after')}
                          highlights={afterHighlights}
                        />
                      )}
                    </div>
                  </div>

                  <div className="card" style={{ marginTop: 20 }}>
                    <h2 className="panel-title">
                      {track.bars.length} change{track.bars.length === 1 ? '' : 's'} in {track.name}
                    </h2>
                    <div className="change-list">
                      {track.bars.map((bar, index) => (
                        <ChangeCard key={index} bar={bar} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The diff identifies a track by name; alphaTab renders by position. The canonical
 * path carries the position, so recover it from there.
 */
function trackIndexFor(track: TrackDiff, side: 'before' | 'after'): number | null {
  const path = side === 'before' ? track.previousPath ?? track.path : track.path;
  const match = path ? /^tracks\/(\d+)-/.exec(path) : null;
  return match ? Number(match[1]) - 1 : null;
}

function ChangeCard({ bar }: { bar: BarChange }) {
  const position = (bar.afterIndex ?? bar.beforeIndex ?? 0) + 1;
  const details = bar.voices.flatMap(voice =>
    voice.beats.map(beat => ({
      key: `${voice.label}-${beat.beforeIndex ?? beat.afterIndex}`,
      text: `Beat ${(beat.afterIndex ?? beat.beforeIndex ?? 0) + 1}: ${beat.description}`
    }))
  );

  return (
    <div className={`change change--${bar.kind}`}>
      <div className="change__head">
        <span className="change__bar">Bar {position}</span>
        <span className="change__kind">{KIND_LABELS[bar.kind]}</span>
      </div>
      <div className="change__summary">{bar.summary}</div>
      {bar.attrs.length > 0 && (
        <ul className="change__details">
          {bar.attrs.map(attr => (
            <li key={attr}>{attr}</li>
          ))}
        </ul>
      )}
      {details.length > 0 && (
        <ul className="change__details">
          {details.map(detail => (
            <li key={detail.key}>{detail.text}</li>
          ))}
        </ul>
      )}
      {bar.kind === 'added' && bar.afterLine && (
        <div className="bar-line bar-line--after" style={{ marginTop: 8 }}>
          {bar.afterLine}
        </div>
      )}
      {bar.kind === 'removed' && bar.beforeLine && (
        <div className="bar-line bar-line--before" style={{ marginTop: 8 }}>
          {bar.beforeLine}
        </div>
      )}
    </div>
  );
}
