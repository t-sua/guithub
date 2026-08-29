import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { timeUntil } from '../format.js';
import type { Invite, PasswordReset, User } from '../types.js';

export function LoginPage() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(username, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <div className="card auth-card">
        <h1>GuitHub</h1>
        <p className="sub">Version control for the band's tabs.</p>
        <form onSubmit={submit}>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              autoComplete="username"
              onChange={event => setUsername(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={event => setPassword(event.target.value)}
              required
            />
          </div>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="sub" style={{ marginTop: 18, marginBottom: 0 }}>
          There is no public sign-up. Ask someone in the band for an invite link.
        </p>
      </div>
    </div>
  );
}

export function MembersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [resets, setResets] = useState<PasswordReset[]>([]);
  const [resetLink, setResetLink] = useState<{ url: string; who: string } | null>(null);
  const [resetCopied, setResetCopied] = useState(false);
  const [label, setLabel] = useState('');
  const [freshLink, setFreshLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [people, pending, recentResets] = await Promise.all([
      api.listUsers(),
      user?.isAdmin ? api.listInvites() : Promise.resolve({ invites: [] as Invite[] }),
      user?.isAdmin ? api.listResets() : Promise.resolve({ resets: [] as PasswordReset[] })
    ]);
    setUsers(people.users);
    setInvites(pending.invites);
    setResets(recentResets.resets);
  };

  useEffect(() => {
    void load().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : 'Could not load members.')
    );
  }, [user?.isAdmin]);

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const result = await api.createInvite(label);
      setFreshLink(result.url);
      setLabel('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the invite.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revokeInvite(id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke the invite.');
    }
  };

  const issueReset = async (member: User) => {
    setError('');
    setResetCopied(false);
    try {
      const result = await api.createReset(member.id);
      setResetLink({ url: result.url, who: member.displayName });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the reset link.');
    }
  };

  const revokeReset = async (id: string) => {
    try {
      await api.revokeReset(id);
      setResetLink(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke the reset link.');
    }
  };

  const copyReset = async () => {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(resetLink.url);
      setResetCopied(true);
    } catch {
      // Clipboard access can be refused; the link is on screen to copy by hand.
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(freshLink);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the link is on screen to copy by hand.
    }
  };

  const pending = invites.filter(item => !item.used);

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1>Band members</h1>
          <p>Everyone who can upload and see the songs.</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="layout-sidebar">
        <div className="card">
          <h2 className="panel-title">Members</h2>
          <div className="version-list">
            {users.map(member => (
              <div key={member.id} className="version-row">
                <div className="version-row__main">
                  <div className="version-row__message">
                    {member.displayName}
                    {member.isAdmin && <span className="version-row__meta"> · admin</span>}
                  </div>
                  <div className="version-row__meta">
                    {member.username} · {member.email}
                  </div>
                </div>
                {user?.isAdmin && member.id !== user.id && (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => void issueReset(member)}
                    title={`Send ${member.displayName} a link to choose a new password`}
                  >
                    Reset password
                  </button>
                )}
              </div>
            ))}
          </div>

          {resetLink && (
            <div className="notice" style={{ marginTop: 16 }}>
              <p style={{ margin: '0 0 8px' }}>
                Send this to {resetLink.who}. It works once, expires in 12 hours, and is
                not shown again. They choose the password — you never see it.
              </p>
              <div className="bar-line" style={{ marginBottom: 8 }}>{resetLink.url}</div>
              <button type="button" className="btn btn--small" onClick={() => void copyReset()}>
                {resetCopied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          )}
        </div>

        {user?.isAdmin && (
          <div>
            <div className="card">
              <h2 className="panel-title">Invite someone</h2>
              <form onSubmit={invite}>
                <div className="field">
                  <label htmlFor="invite-label">Who is it for? (optional)</label>
                  <input
                    id="invite-label"
                    value={label}
                    onChange={event => setLabel(event.target.value)}
                    placeholder="Dave, bass"
                  />
                </div>
                <button className="btn btn--primary" type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create invite link'}
                </button>
              </form>

              {freshLink && (
                <div className="notice" style={{ marginTop: 16 }}>
                  <p style={{ margin: '0 0 8px' }}>
                    Send them this link. It works once, and only for the next 7 days —
                    it is not shown again.
                  </p>
                  <div className="bar-line" style={{ marginBottom: 8 }}>{freshLink}</div>
                  <button type="button" className="btn btn--small" onClick={() => void copy()}>
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                </div>
              )}
            </div>

            {pending.length > 0 && (
              <div className="card" style={{ marginTop: 16 }}>
                <h2 className="panel-title">Pending invites</h2>
                <div className="version-list">
                  {pending.map(item => (
                    <div key={item.id} className="version-row">
                      <span className="version-row__main">
                        <span className="version-row__message">{item.label || 'Unlabelled'}</span>
                        <span className="version-row__meta">
                          expires {timeUntil(item.expiresAt)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => void revoke(item.id)}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {resets.length > 0 && (
              <div className="card" style={{ marginTop: 16 }}>
                <h2 className="panel-title">Password resets</h2>
                <p className="sub" style={{ marginTop: 0 }}>
                  Kept on the record, used or not, so a reset is never invisible.
                </p>
                <div className="version-list">
                  {resets.map(item => (
                    <div key={item.id} className="version-row">
                      <span className="version-row__main">
                        <span className="version-row__message">{item.displayName}</span>
                        <span className="version-row__meta">
                          issued by {item.issuedBy} ·{' '}
                          {item.used ? 'used' : `expires ${timeUntil(item.expiresAt)}`}
                        </span>
                      </span>
                      {!item.used && (
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() => void revokeReset(item.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
