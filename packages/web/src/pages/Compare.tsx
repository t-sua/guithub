import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { TabViewer, type BarHighlight } from '../components/TabViewer.js';
import { BarStrip } from '../components/BarStrip.js';
import { relativeTime } from '../format.js';
import type { BarChange, ChangeKind, SongDiff, TrackDiff, Version } from '../types.js';

/**
 * New music is green and old music is red, the way a code diff reads. These are CSS
 * variables rather than literals so the tints follow the light/dark theme without
 * this component needing to know which one is active.
 */
const KIND_COLORS: Record<ChangeKind, string> = {
  added: 'var(--tint-added)',
  modified: 'var(--tint-added)',
  removed: 'var(--tint-removed)',
  moved: 'var(--tint-moved)'
};

const KIND_EDGES: Record<ChangeKind, string> = {
  added: 'var(--tint-added-edge)',
  modified: 'var(--tint-added-edge)',
  removed: 'var(--tint-removed-edge)',
  moved: 'var(--tint-moved-edge)'
};

const KIND_LABELS: Record<ChangeKind, string> = {
  added: 'added',
  removed: 'removed',
  modified: 'changed',
  moved: 'moved'
};

type Layout = 'unified' | 'split';

export function ComparePage() {
  const { slug = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [versions, setVersions] = useState<Version[]>([]);
  const [diff, setDiff] = useState<SongDiff | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTrack, setActiveTrack] = useState(0);
  const [layout, setLayout] = useState<Layout>('unified');
  const [beforeData, setBeforeData] = useState<ArrayBuffer | null>(null);
  const [afterData, setAfterData] = useState<ArrayBuffer | null>(null);

  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  useEffect(() => {
    void api
      .getSong(slug)
      .then(result => {
        setVersions(result.versions);
        if ((!from || !to) && result.versions.length >= 2) {
          setSearchParams(
            { from: result.versions[1]!.commit, to: result.versions[0]!.commit },
            { replace: true }
          );
        }
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not load the song.')
      );
  }, [slug]);

  useEffect(() => {
    if (!from || !to) return;
    setLoading(true);
    void api
      .getDiff(slug, from, to)
      .then(result => {
        setDiff(result.diff);
        setActiveTrack(0);
        setError('');
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not compare those versions.')
      )
      .finally(() => setLoading(false));
  }, [slug, from, to]);

  // Both files are fetched once here and shared by every bar strip, so a diff with
  // thirty changes still costs two downloads.
  useEffect(() => {
    let cancelled = false;
    setBeforeData(null);
    setAfterData(null);
    const grab = async (commit: string, set: (b: ArrayBuffer) => void) => {
      if (!commit) return;
      const response = await fetch(api.fileUrl(slug, commit), { credentials: 'same-origin' });
      if (!response.ok) return;
      const buffer = await response.arrayBuffer();
      if (!cancelled) set(buffer);
    };
    void grab(from, setBeforeData);
    void grab(to, setAfterData);
    return () => {
      cancelled = true;
    };
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
      const position = (bar.afterIndex ?? bar.beforeIndex ?? 0) + 1;
      const highlight: BarHighlight = {
        color: KIND_COLORS[bar.kind],
        edge: KIND_EDGES[bar.kind],
        label: `bar ${position}`,
        title: `Bar ${position} — ${bar.summary}`
      };
      if (bar.beforeIndex !== null) before.set(bar.beforeIndex, highlight);
      if (bar.afterIndex !== null) after.set(bar.afterIndex, highlight);
    }
    return { beforeHighlights: before, afterHighlights: after };
  }, [track]);

  const fromVersion = versions.find(version => version.commit === from);
  const toVersion = versions.find(version => version.commit === to);
  const beforeTrackIndex = track ? trackIndexFor(track, 'before') : null;
  const afterTrackIndex = track ? trackIndexFor(track, 'after') : null;

  const scrollToBar = (position: number) => {
    document
      .getElementById(`change-${position}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="container container--wide">
      <div className="page-header">
        <div>
          <div className="breadcrumb">
            <Link to="/">Songs</Link> / <Link to={`/songs/${slug}`}>{slug}</Link> / Compare
          </div>
          <h1>Compare versions</h1>
        </div>
        <div className="page-header__actions">
          <div className="segmented">
            <button
              className={`segmented__option ${layout === 'unified' ? 'segmented__option--active' : ''}`}
              onClick={() => setLayout('unified')}
            >
              Unified
            </button>
            <button
              className={`segmented__option ${layout === 'split' ? 'segmented__option--active' : ''}`}
              onClick={() => setLayout('split')}
            >
              Side by side
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="version-pickers">
          <div className="field">
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
          <div className="field">
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
                  <div key={index} className={`change change--${bar.kind}`}>
                    <div className="change__head">
                      <span className="change__bar">
                        Bar {(bar.afterIndex ?? bar.beforeIndex ?? 0) + 1}
                      </span>
                      <span className="change__kind">{KIND_LABELS[bar.kind]}</span>
                    </div>
                    <div className="change__summary">{bar.summary}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {changedTracks.length > 0 && track && (
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
                      ({candidate.bars.length})
                    </span>
                  </button>
                ))}
              </div>

              <div className="track-summary">
                <span className="track-summary__name">{track.name}</span>
                {track.barsAdded > 0 && <span className="stat stat--added">+{track.barsAdded} bars</span>}
                {track.barsRemoved > 0 && <span className="stat stat--removed">−{track.barsRemoved} bars</span>}
                {track.barsModified > 0 && <span className="stat stat--modified">~{track.barsModified} changed</span>}
                {track.barsMoved > 0 && <span className="stat stat--moved">⇄{track.barsMoved} moved</span>}
              </div>

              {layout === 'unified' ? (
                <>
                  <h2 className="panel-title">
                    {toVersion ? `“${toVersion.message}” — changed bars highlighted` : 'Score'}
                  </h2>
                  {to && (
                    <TabViewer
                      key={`after-${to}-${track.name}`}
                      fileUrl={api.fileUrl(slug, to)}
                      trackIndex={afterTrackIndex}
                      highlights={afterHighlights}
                      onBarClick={bar => scrollToBar(bar + 1)}
                    />
                  )}
                </>
              ) : (
                <div className="split">
                  <div>
                    <h2 className="panel-title">Before — {fromVersion?.message ?? 'earlier'}</h2>
                    {from && (
                      <TabViewer
                        key={`split-before-${from}-${track.name}`}
                        fileUrl={api.fileUrl(slug, from)}
                        trackIndex={beforeTrackIndex}
                        highlights={beforeHighlights}
                      />
                    )}
                  </div>
                  <div>
                    <h2 className="panel-title">After — {toVersion?.message ?? 'later'}</h2>
                    {to && (
                      <TabViewer
                        key={`split-after-${to}-${track.name}`}
                        fileUrl={api.fileUrl(slug, to)}
                        trackIndex={afterTrackIndex}
                        highlights={afterHighlights}
                      />
                    )}
                  </div>
                </div>
              )}

              <h2 className="panel-title" style={{ marginTop: 28 }}>
                {track.bars.length} change{track.bars.length === 1 ? '' : 's'} in {track.name}
              </h2>
              <div className="change-list">
                {track.bars.map((bar, index) => (
                  <ChangeCard
                    key={index}
                    bar={bar}
                    beforeData={beforeData}
                    afterData={afterData}
                    beforeTrackIndex={beforeTrackIndex}
                    afterTrackIndex={afterTrackIndex}
                  />
                ))}
              </div>
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
  const path = side === 'before' ? (track.previousPath ?? track.path) : track.path;
  const match = path ? /^tracks\/(\d+)-/.exec(path) : null;
  return match ? Number(match[1]) - 1 : null;
}

interface ChangeCardProps {
  readonly bar: BarChange;
  readonly beforeData: ArrayBuffer | null;
  readonly afterData: ArrayBuffer | null;
  readonly beforeTrackIndex: number | null;
  readonly afterTrackIndex: number | null;
}

function ChangeCard({
  bar,
  beforeData,
  afterData,
  beforeTrackIndex,
  afterTrackIndex
}: ChangeCardProps) {
  const position = (bar.afterIndex ?? bar.beforeIndex ?? 0) + 1;
  const details = bar.voices.flatMap(voice =>
    voice.beats.map(beat => ({
      key: `${voice.label}-${beat.beforeIndex ?? beat.afterIndex}`,
      text: `Beat ${(beat.afterIndex ?? beat.beforeIndex ?? 0) + 1}: ${beat.description}`
    }))
  );

  // A moved bar is the same music in a new place, so showing it twice says nothing.
  const showNew = bar.afterIndex !== null && bar.kind !== 'moved';
  const showOld = bar.beforeIndex !== null && bar.kind !== 'added' && bar.kind !== 'moved';

  return (
    <div className={`change change--${bar.kind}`} id={`change-${position}`}>
      <div className="change__head">
        <span className="change__bar">Bar {position}</span>
        <span className={`change__kind change__kind--${bar.kind}`}>{KIND_LABELS[bar.kind]}</span>
        <span className="change__summary">{bar.summary}</span>
      </div>

      {showNew && afterTrackIndex !== null && (
        <BarStrip
          data={afterData}
          trackIndex={afterTrackIndex}
          bar={bar.afterIndex!}
          tone="new"
          label={bar.kind === 'added' ? 'added' : 'new'}
        />
      )}
      {showOld && beforeTrackIndex !== null && (
        <BarStrip
          data={beforeData}
          trackIndex={beforeTrackIndex}
          bar={bar.beforeIndex!}
          tone="old"
          label={bar.kind === 'removed' ? 'removed' : 'old'}
        />
      )}

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
    </div>
  );
}
