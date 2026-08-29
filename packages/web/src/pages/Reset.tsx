import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.js';

const MIN_LENGTH = 8;

/**
 * Redeeming a password reset link. Reachable while signed out, because someone who
 * has forgotten their password cannot sign in to get here.
 */
export function ResetPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState('');
  const [account, setAccount] = useState({ username: '', displayName: '' });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .checkReset(token)
      .then(result => {
        if (!cancelled) setAccount({ username: result.username, displayName: result.displayName });
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setInvalid(caught instanceof Error ? caught.message : 'This reset link is not valid.');
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirmation.length > 0 && confirmation !== password;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.acceptReset(token, password);
      await refresh();
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not set the password.');
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className="container">
        <div className="card auth-card">
          <p>Checking your link…</p>
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
            Reset links are single-use and expire. Ask an admin for a fresh one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card auth-card">
        <h1>Choose a new password</h1>
        <p className="sub">
          For {account.displayName} ({account.username}). Nobody else sees what you type
          here, including whoever sent you the link.
        </p>
        <form onSubmit={submit}>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              value={password}
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              onChange={event => setPassword(event.target.value)}
              required
            />
            {tooShort && (
              <p className="sub" style={{ margin: '6px 0 0' }}>
                At least {MIN_LENGTH} characters. A short phrase beats a short password.
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="confirm-password">New password again</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmation}
              autoComplete="new-password"
              onChange={event => setConfirmation(event.target.value)}
              required
            />
            {mismatch && (
              <p className="sub" style={{ margin: '6px 0 0' }}>
                These do not match yet.
              </p>
            )}
          </div>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={busy || tooShort || mismatch}
          >
            {busy ? 'Setting…' : 'Set password and sign in'}
          </button>
        </form>
        <p className="sub" style={{ marginTop: 18, marginBottom: 0 }}>
          Using this link signs out every other browser your account was signed in on.
        </p>
      </div>
    </div>
  );
}
