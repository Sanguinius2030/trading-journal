import type { Trade } from '../types';

// Lighter API configuration (for frontend checks only, actual API calls go through serverless proxy)
const LIGHTER_WALLET_ADDRESS = import.meta.env.VITE_LIGHTER_WALLET_ADDRESS || '';
const LIGHTER_API_KEY = import.meta.env.VITE_LIGHTER_API_KEY || '';

interface LighterTrade {
  id: string;
  market: string;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  timestamp: number;
  pnl?: string;
  // Add more fields as needed based on actual API response
}

/**
 * Fetch account ID from Ethereum address using serverless proxy
 */
async function getAccountByAddress(walletAddress: string): Promise<any> {
  // Normalize address to lowercase as blockchain APIs often expect lowercase addresses
  const normalizedAddress = walletAddress.toLowerCase();
  // The API expects two parameters: 'by' and 'value' (not just l1_address)
  const response = await fetch(`/api/lighter-proxy?endpoint=accountsByL1Address&by=l1_address&value=${normalizedAddress}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch account: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Fetch trading history from Lighter DEX using serverless proxy
 */
export async function fetchLighterTrades(walletAddress: string): Promise<Trade[]> {
  if (!walletAddress) {
    throw new Error('Wallet address is required to fetch trades');
  }

  try {
    // First, get the account information from the L1 address
    const accountData = await getAccountByAddress(walletAddress);

    // If no account found, return empty array (user hasn't traded on Lighter yet)
    if (!accountData || !accountData.accounts || accountData.accounts.length === 0) {
      console.log('No Lighter account found for this address');
      return [];
    }

    const accountId = accountData.accounts[0].id;

    // Now fetch trades for this account using proxy
    const response = await fetch(`/api/lighter-proxy?endpoint=trades&account=${accountId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Lighter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Transform Lighter trades to our Trade format
    return transformLighterTrades(data.trades || data || []);
  } catch (error) {
    console.error('Error fetching Lighter trades:', error);
    throw error;
  }
}

/**
 * Transform Lighter trade format to our application's Trade type
 */
function transformLighterTrades(lighterTrades: LighterTrade[]): Trade[] {
  return lighterTrades.map((trade, index) => {
    const price = parseFloat(trade.price);
    const size = parseFloat(trade.size);
    const pnl = trade.pnl ? parseFloat(trade.pnl) : undefined;

    // Determine if it's a long or short based on the side
    const type: 'long' | 'short' = trade.side === 'buy' ? 'long' : 'short';

    return {
      id: trade.id || `lighter-${index}`,
      symbol: trade.market || 'UNKNOWN',
      type,
      status: pnl !== undefined ? 'closed' : 'open',
      entryPrice: price,
      exitPrice: pnl !== undefined ? price + (pnl / size) : undefined,
      quantity: size,
      entryDate: new Date(trade.timestamp),
      exitDate: pnl !== undefined ? new Date(trade.timestamp) : undefined,
      pnl,
      pnlPercent: pnl !== undefined ? (pnl / (price * size)) * 100 : undefined,
      exchange: 'Lighter',
      // Add notes/reasoning if available from API
    } as Trade;
  });
}

/**
 * Get user's wallet address from environment or prompt
 */
export function getWalletAddress(): string {
  return LIGHTER_WALLET_ADDRESS;
}

/**
 * Check if Lighter integration is configured
 */
export function isLighterConfigured(): boolean {
  return !!LIGHTER_WALLET_ADDRESS && !!LIGHTER_API_KEY;
}
