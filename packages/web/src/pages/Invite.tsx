import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.js';

/**
 * Accepting an invite. Reachable while signed out — this is the only way into the
 * instance, so it has to work for someone who has never been here before.
 */
export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState('');
  const [label, setLabel] = useState('');
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .checkInvite(token)
      .then(result => {
        if (!cancelled) setLabel(result.label);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setInvalid(caught instanceof Error ? caught.message : 'This invite link is not valid.');
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.acceptInvite({ token, ...form });
      await refresh();
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the account.');
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className="container">
        <div className="card auth-card">
          <p>Checking your invite…</p>
        </div>
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="container">
        <div className="card auth-card">
          <h1>That link doesn't work</h1>
          <p className="sub">{invalid}</p>
          <p className="sub">
            Invite links can only be used once and expire after a week. Ask whoever sent it
            for a fresh one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card auth-card">
        <h1>Join GuitHub</h1>
        <p className="sub">
          {label ? `You were invited as "${label}". ` : ''}
          Pick a username and password — nobody else sees the password, not even the person
          who invited you.
        </p>
        <form onSubmit={submit}>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label htmlFor="i-name">Your name</label>
            <input
              id="i-name"
              value={form.displayName}
              onChange={event => setForm({ ...form, displayName: event.target.value })}
              placeholder="Shown next to every change you make"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label htmlFor="i-username">Username</label>
            <input
              id="i-username"
              value={form.username}
              onChange={event => setForm({ ...form, username: event.target.value })}
              autoComplete="username"
              minLength={2}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="i-email">Email</label>
            <input
              id="i-email"
              type="email"
              value={form.email}
              onChange={event => setForm({ ...form, email: event.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="i-password">Password</label>
            <input
              id="i-password"
              type="password"
              value={form.password}
              onChange={event => setForm({ ...form, password: event.target.value })}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Creating your account…' : 'Join the band'}
          </button>
        </form>
      </div>
    </div>
  );
}
