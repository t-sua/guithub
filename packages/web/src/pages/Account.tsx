import { useState, type FormEvent } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';

const MIN_LENGTH = 8;

export function AccountPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // Checked here only to say so before a round trip; the server enforces it too.
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const mismatch = confirmation.length > 0 && confirmation !== newPassword;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setDone(false);
    if (newPassword !== confirmation) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1>Your account</h1>
          <p>
            Signed in as {user?.displayName} ({user?.username}).
          </p>
        </div>
      </div>

      <div className="card auth-card">
        <h2 className="panel-title">Change your password</h2>
        <form onSubmit={submit}>
          {error && <div className="error-banner">{error}</div>}
          {done && (
            <div className="notice" style={{ marginBottom: 16 }}>
              Password changed. Any other browser you were signed in on has been signed
              out; this one stays.
            </div>
          )}
          <div className="field">
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              autoComplete="current-password"
              onChange={event => setCurrentPassword(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              onChange={event => setNewPassword(event.target.value)}
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
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </div>
    </div>
  );
}
