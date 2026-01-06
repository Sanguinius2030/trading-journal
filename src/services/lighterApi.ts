import type { Trade } from '../types';

// Lighter API configuration (for frontend checks only, actual API calls go through serverless proxy)
const LIGHTER_WALLET_ADDRESS = import.meta.env.VITE_LIGHTER_WALLET_ADDRESS || '';
const LIGHTER_API_KEY = import.meta.env.VITE_LIGHTER_API_KEY || '';

/**
 * Fetch account ID from Ethereum address using serverless proxy
 * Uses /api/v1/account endpoint with by=l1_address and value=<address>
 * IMPORTANT: Address must keep original checksummed case (not lowercase)
 */
async function getAccountByAddress(walletAddress: string): Promise<any> {
  // Use /account endpoint with by and value params (as per Python SDK get_info.py example)
  // Keep original case - Lighter API requires checksummed address format
  const response = await fetch(`/api/lighter-proxy?endpoint=account&by=l1_address&value=${walletAddress}`, {
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
 * Fetch account data from Lighter DEX (positions, balances)
 * Note: Trade history requires signed authentication which is not yet implemented
 */
export async function fetchLighterTrades(walletAddress: string): Promise<Trade[]> {
  if (!walletAddress) {
    throw new Error('Wallet address is required to fetch trades');
  }

  try {
    // Get the account information from the L1 address
    const accountData = await getAccountByAddress(walletAddress);
    console.log('Lighter account data:', accountData);

    // If no account found, return empty array
    if (!accountData || !accountData.accounts || accountData.accounts.length === 0) {
      console.log('No Lighter account found for this address');
      return [];
    }

    const account = accountData.accounts[0];
    console.log('Account index:', account.index);
    console.log('Account positions:', account.positions);

    // Transform positions into trades (open positions)
    // Each position represents an open trade
    const positions = account.positions || [];
    return positions.map((pos: any, index: number) => ({
      id: `lighter-pos-${index}`,
      symbol: pos.market_id !== undefined ? `Market ${pos.market_id}` : 'UNKNOWN',
      type: parseFloat(pos.size || '0') >= 0 ? 'long' : 'short',
      status: 'open' as const,
      entryPrice: parseFloat(pos.entry_price || pos.avg_entry_price || '0'),
      quantity: Math.abs(parseFloat(pos.size || '0')),
      entryDate: new Date(),
      exchange: 'Lighter',
      pnl: parseFloat(pos.unrealized_pnl || '0'),
    } as Trade));
  } catch (error) {
    console.error('Error fetching Lighter account:', error);
    throw error;
  }
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
