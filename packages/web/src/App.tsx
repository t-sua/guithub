import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.js';
import { AuthorColorProvider } from './authors.js';
import { ThemeProvider, useTheme } from './theme.js';
import { LoginPage, MembersPage } from './pages/Auth.js';
import { AccountPage } from './pages/Account.js';
import { SongsPage } from './pages/Songs.js';
import { SongPage } from './pages/Song.js';
import { ComparePage } from './pages/Compare.js';
import { BlamePage } from './pages/Blame.js';
import { InvitePage } from './pages/Invite.js';
import { ResetPage } from './pages/Reset.js';

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="btn btn--small"
      onClick={toggle}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function Shell() {
  const { user, loading, signOut } = useAuth();

  if (loading) return <div className="container">Loading…</div>;

  // Accepting an invite has to work for someone with no account yet, so this route
  // sits outside the sign-in gate.
  if (!user) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/reset/:token" element={<ResetPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <AuthorColorProvider>
    <div className="app">
      <nav className="topbar">
        <Link to="/" className="topbar__brand">
          GuitHub
        </Link>
        <Link to="/">Songs</Link>
        <Link to="/members">Members</Link>
        <span className="topbar__spacer" />
        <Link to="/account" className="topbar__user" title="Your account">
          {user.displayName}
        </Link>
        <ThemeToggle />
        <button className="btn btn--small" onClick={() => void signOut()}>
          Sign out
        </button>
      </nav>
      <Routes>
        <Route path="/" element={<SongsPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/invite/:token" element={<Navigate to="/" replace />} />
        <Route path="/reset/:token" element={<ResetPage />} />
        <Route path="/songs/:slug" element={<SongPage />} />
        <Route path="/songs/:slug/compare" element={<ComparePage />} />
        <Route path="/songs/:slug/blame" element={<BlamePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
    </AuthorColorProvider>
  );
}
