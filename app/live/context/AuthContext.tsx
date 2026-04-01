'use client';
import {
  createContext, useContext, useEffect, useState, useCallback,
} from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// ── Profile shape — mirrors public.users table ────
export interface UserProfile {
  id:             string;
  handle:         string;
  avatarInitials: string;
  balance:        number;
  role:           'buyer' | 'seller' | 'manager';
}

interface AuthContextValue {
  user:            User | null;
  profile:         UserProfile | null;
  session:         Session | null;
  loading:         boolean;
  signIn:          (handle: string, password: string) => Promise<{ error: string | null }>;
  signUp:          (handle: string, email: string, password: string, role: 'buyer' | 'seller' | 'manager') => Promise<{ error: string | null }>;
  signOut:         () => Promise<void>;
  refreshProfile:  () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('users')
      .select('id, handle, avatar_initials, balance, role')
      .eq('id', userId)
      .single();
    
    if (error || !data) return;

    const normalizedBalance = data.balance ?? 0;
    if (data.balance === null) {
      await supabase.from('users').update({ balance: 0 }).eq('id', userId);
    }

    setProfile({
      id:             data.id,
      handle:         data.handle,
      avatarInitials: data.avatar_initials,
      balance:        normalizedBalance,
      role:           data.role,
    });
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error && error.message.includes('Refresh Token')) {
        supabase.auth.signOut().catch(() => {});
      }
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) fetchProfile(session.user.id);
        else setProfile(null);
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signIn = useCallback(async (handle: string, password: string) => {
    if (!supabase) return { error: 'Supabase not initialized' };
    const email = `${handle.trim().toLowerCase()}@auction-terminal.local`;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (
    handle:   string,
    email:    string,
    password: string,
    role:     'buyer' | 'seller' | 'manager',
  ) => {
    if (!supabase) return { error: 'Supabase not initialized' };
    const fakeEmail = `${handle.trim().toLowerCase()}@auction-terminal.local`;
    const { error } = await supabase.auth.signUp({
      email:    fakeEmail,
      password,
      options: {
        data: { handle, role, balance: 0 },
        emailRedirectTo: undefined,
      },
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, signIn, signUp, signOut, refreshProfile: () => fetchProfile(user?.id ?? '') }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  // During build pre-rendering, contexts might be missing. We return a safe 
  // placeholder instead of throwing or returning null, to prevent crashes.
  return ctx || {
    user: null,
    profile: null,
    session: null,
    loading: true,
    signIn: async () => ({ error: 'not_initialized' }),
    signUp: async () => ({ error: 'not_initialized' }),
    signOut: async () => {},
    refreshProfile: async () => {},
  } as AuthContextValue;
}