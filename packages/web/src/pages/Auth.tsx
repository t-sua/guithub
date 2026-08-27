import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';

export function LoginPage() {
  const { signIn, needsFirstUser } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (needsFirstUser) return <FirstUserPage />;

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
      </div>
    </div>
  );
}

/**
 * Shown only while the instance has no accounts at all. The first person through
 * becomes the admin and can then add the rest of the band.
 */
function FirstUserPage() {
  const { refresh } = useAuth();
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createUser(form);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the account.');
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <div className="card auth-card">
        <h1>Set up GuitHub</h1>
        <p className="sub">
          This instance has no accounts yet. Create yours — you'll be the admin and can add
          the rest of the band afterwards.
        </p>
        <form onSubmit={submit}>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label htmlFor="displayName">Your name</label>
            <input
              id="displayName"
              value={form.displayName}
              onChange={event => setForm({ ...form, displayName: event.target.value })}
              placeholder="Shown next to every change you make"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-username">Username</label>
            <input
              id="new-username"
              value={form.username}
              onChange={event => setForm({ ...form, username: event.target.value })}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={event => setForm({ ...form, email: event.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">Password</label>
            <input
              id="new-password"
              type="password"
              value={form.password}
              onChange={event => setForm({ ...form, password: event.target.value })}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function MembersPage() {
  const { user, refresh } = useAuth();
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.listUsers>>['users']>([]);
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.listUsers().then(result => setUsers(result.users));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setDone('');
    try {
      const created = await api.createUser(form);
      setDone(`Added ${created.user.displayName}. Give them the password you just set.`);
      setForm({ username: '', displayName: '', email: '', password: '' });
      const result = await api.listUsers();
      setUsers(result.users);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the member.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1>Band members</h1>
          <p>Everyone who can upload and see the songs.</p>
        </div>
      </div>

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
              </div>
            ))}
          </div>
        </div>

        {user?.isAdmin && (
          <div className="card">
            <h2 className="panel-title">Add a member</h2>
            <form onSubmit={submit}>
              {error && <div className="error-banner">{error}</div>}
              {done && <div className="notice">{done}</div>}
              <div className="field">
                <label htmlFor="m-name">Name</label>
                <input
                  id="m-name"
                  value={form.displayName}
                  onChange={event => setForm({ ...form, displayName: event.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="m-username">Username</label>
                <input
                  id="m-username"
                  value={form.username}
                  onChange={event => setForm({ ...form, username: event.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="m-email">Email</label>
                <input
                  id="m-email"
                  type="email"
                  value={form.email}
                  onChange={event => setForm({ ...form, email: event.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="m-password">Temporary password</label>
                <input
                  id="m-password"
                  value={form.password}
                  onChange={event => setForm({ ...form, password: event.target.value })}
                  minLength={8}
                  required
                />
              </div>
              <button className="btn btn--primary" type="submit" disabled={busy}>
                {busy ? 'Adding…' : 'Add member'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
