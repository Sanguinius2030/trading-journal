import { useState, useEffect, useCallback } from 'react';
import type { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, isProduction } from '../lib/supabase';

interface UserSettings {
  lighter_account_index: number | null;
  lighter_auth_token: string | null;
  starting_capital: number;
  currency: string;
  timezone: string;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  settings: UserSettings | null;
}

interface AuthActions {
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
  updateSettings: (settings: Partial<UserSettings>) => Promise<{ error: Error | null }>;
}

export function useAuth(): AuthState & AuthActions {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<UserSettings | null>(null);

  // Load user settings from Supabase with timeout
  const loadSettings = useCallback(async (userId: string) => {
    // Set defaults first so app works even if DB fails
    const defaults: UserSettings = {
      lighter_account_index: null,
      lighter_auth_token: null,
      starting_capital: 10000,
      currency: 'USD',
      timezone: 'Europe/Berlin',
    };

    try {
      // Add 15 second timeout to prevent hanging (increased from 5s for slower connections)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Settings load timeout after 15s')), 15000)
      );

      const queryPromise = supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]) as Awaited<typeof queryPromise>;

      if (error && error.code !== 'PGRST116') {
        // PGRST116 is "not found" - that's ok for new users
        console.error('Failed to load user settings:', error);
        setSettings(defaults);
        return;
      }

      if (data) {
        setSettings({
          lighter_account_index: data.lighter_account_index,
          lighter_auth_token: data.lighter_auth_token,
          starting_capital: data.starting_capital || 10000,
          currency: data.currency || 'USD',
          timezone: data.timezone || 'Europe/Berlin',
        });
      } else {
        setSettings(defaults);
      }
    } catch (err) {
      console.error('Failed to load user settings:', err);
      setSettings(defaults);
    }
  }, []);

  // Initialize auth state
  useEffect(() => {
    // In local development, skip auth entirely (regardless of Supabase config)
    if (!isProduction) {
      setLoading(false);
      return;
    }

    // In production without Supabase configured, also skip
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadSettings(session.user.id);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        await loadSettings(session.user.id);
      } else {
        setSettings(null);
      }

      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [loadSettings]);

  // Sign in with email and password
  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  }, []);

  // Sign up with email and password
  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    return { error };
  }, []);

  // Sign out
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setSettings(null);
  }, []);

  // Update user settings with timeout
  const updateSettings = useCallback(
    async (newSettings: Partial<UserSettings>) => {
      if (!user) {
        return { error: new Error('Not authenticated') };
      }

      try {
        // Add 10 second timeout to prevent hanging
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Save timeout - please try again')), 10000)
        );

        const upsertPromise = supabase
          .from('user_settings')
          .upsert(
            {
              user_id: user.id,
              ...newSettings,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );

        const { error } = await Promise.race([upsertPromise, timeoutPromise]);

        if (error) {
          return { error: new Error(error.message) };
        }

        // Update local state optimistically
        setSettings((prev) => (prev ? { ...prev, ...newSettings } : null));
        return { error: null };
      } catch (err) {
        return { error: err as Error };
      }
    },
    [user]
  );

  return {
    user,
    session,
    loading,
    settings,
    signIn,
    signUp,
    signOut,
    updateSettings,
  };
}

// Type for the auth context value
export type AuthContextType = ReturnType<typeof useAuth>;
