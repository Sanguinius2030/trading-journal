import type { Trade } from '../types';

// Lighter API configuration
const LIGHTER_API_BASE_URL = import.meta.env.VITE_LIGHTER_API_URL || 'https://mainnet.zklighter.elliot.ai';
const LIGHTER_WALLET_ADDRESS = import.meta.env.VITE_LIGHTER_WALLET_ADDRESS || '';

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
 * Fetch trading history from Lighter DEX
 */
export async function fetchLighterTrades(walletAddress: string): Promise<Trade[]> {
  if (!walletAddress) {
    throw new Error('Wallet address is required to fetch trades');
  }

  try {
    // Note: This is a placeholder URL structure - adjust based on actual Lighter API documentation
    const response = await fetch(`${LIGHTER_API_BASE_URL}/api/v1/trades?address=${walletAddress}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Add authentication headers if required
      },
    });

    if (!response.ok) {
      throw new Error(`Lighter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Transform Lighter trades to our Trade format
    return transformLighterTrades(data.trades || []);
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
  return !!LIGHTER_WALLET_ADDRESS;
}
