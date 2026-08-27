import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api.js';
import type { User } from './types.js';

interface AuthState {
  readonly user: User | null;
  readonly loading: boolean;
  readonly needsFirstUser: boolean;
  readonly signIn: (username: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [needsFirstUser, setNeedsFirstUser] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [me, setup] = await Promise.all([api.me(), api.setup()]);
    setUser(me.user);
    setNeedsFirstUser(setup.needsFirstUser);
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      needsFirstUser,
      signIn: async (username, password) => {
        const result = await api.login(username, password);
        setUser(result.user);
        setNeedsFirstUser(false);
      },
      signOut: async () => {
        await api.logout();
        setUser(null);
      },
      refresh
    }),
    [user, loading, needsFirstUser, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
