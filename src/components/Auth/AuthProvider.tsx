import { createContext, useContext, type ReactNode } from 'react';
import { useAuth, type AuthContextType } from '../../hooks/useAuth';
import { isProduction, isSupabaseConfigured } from '../../lib/supabase';

// Create the auth context
const AuthContext = createContext<AuthContextType | null>(null);

// Provider component
interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const auth = useAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

// Hook to use auth context
export function useAuthContext(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}

// Check if authentication is required
// In production with Supabase configured, auth is required
// In local development, auth is optional
export function isAuthRequired(): boolean {
  return isProduction && isSupabaseConfigured;
}
