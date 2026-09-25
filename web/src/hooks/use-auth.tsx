'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { can, type Permission, type User } from '@flowdesk/shared';
import { getApi } from '@/lib/api';

interface AuthContextValue {
  /** `undefined` until the session has been read from storage (client only). */
  user: User | null | undefined;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  can: (permission: Permission, resource?: { ownerId?: string | null }) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    const store = getApi().session;
    setUser(store.get()?.user ?? null);
    return store.subscribe((session) => {
      setUser(session?.user ?? null);
      if (!session) queryClient.clear();
    });
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await getApi().auth.login(email, password);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    await getApi().auth.logout();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      login,
      logout,
      can: (permission, resource) => can(user ?? null, permission, resource),
    }),
    [user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
