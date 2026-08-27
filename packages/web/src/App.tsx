import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.js';
import { LoginPage, MembersPage } from './pages/Auth.js';
import { SongsPage } from './pages/Songs.js';
import { SongPage } from './pages/Song.js';
import { ComparePage } from './pages/Compare.js';
import { BlamePage } from './pages/Blame.js';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  );
}

function Shell() {
  const { user, loading, signOut } = useAuth();

  if (loading) return <div className="container">Loading…</div>;
  if (!user) return <LoginPage />;

  return (
    <div className="app">
      <nav className="topbar">
        <Link to="/" className="topbar__brand">
          GuitHub
        </Link>
        <Link to="/">Songs</Link>
        <Link to="/members">Members</Link>
        <span className="topbar__spacer" />
        <span className="topbar__user">{user.displayName}</span>
        <button className="btn btn--small" onClick={() => void signOut()}>
          Sign out
        </button>
      </nav>
      <Routes>
        <Route path="/" element={<SongsPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/songs/:slug" element={<SongPage />} />
        <Route path="/songs/:slug/compare" element={<ComparePage />} />
        <Route path="/songs/:slug/blame" element={<BlamePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
