import { useState, useEffect } from 'react';
import { fetchLighterTrades, getWalletAddress, isLighterConfigured } from '../services/lighterApi';
import type { Trade } from '../types';

interface UseLighterTradesResult {
  trades: Trade[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  isConfigured: boolean;
}

/**
 * Custom hook to fetch and manage Lighter DEX trades
 */
export function useLighterTrades(): UseLighterTradesResult {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfigured] = useState(isLighterConfigured());

  const fetchTrades = async () => {
    if (!isConfigured) {
      setError('Lighter wallet address not configured. Please set VITE_LIGHTER_WALLET_ADDRESS in .env');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const walletAddress = getWalletAddress();
      const lighterTrades = await fetchLighterTrades(walletAddress);
      setTrades(lighterTrades);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch trades from Lighter';
      setError(errorMessage);
      console.error('Error fetching Lighter trades:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch trades on mount if configured
  useEffect(() => {
    if (isConfigured) {
      fetchTrades();
    }
  }, [isConfigured]);

  return {
    trades,
    loading,
    error,
    refetch: fetchTrades,
    isConfigured,
  };
}
