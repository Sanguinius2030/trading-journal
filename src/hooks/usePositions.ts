import { useState, useEffect, useCallback } from 'react';
import { fetchPositions } from '../services/supabaseData';
import type { Position, PositionsData } from '../services/supabaseData';
import { useAuthContext } from '../components/Auth/AuthProvider';

interface UsePositionsReturn {
  positions: Position[];
  loading: boolean;
  error: string | null;
  summary: PositionsData['summary'] | null;
  balance: PositionsData['balance'] | null;
  refetch: () => Promise<void>;
}

export function usePositions(): UsePositionsReturn {
  const { session } = useAuthContext();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PositionsData['summary'] | null>(null);
  const [balance, setBalance] = useState<PositionsData['balance'] | null>(null);

  const loadPositions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchPositions(session?.access_token);
      setPositions(data.positions);
      setSummary(data.summary);
      setBalance(data.balance);
    } catch (err) {
      console.error('Failed to load positions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load positions');
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  return {
    positions,
    loading,
    error,
    summary,
    balance,
    refetch: loadPositions
  };
}
