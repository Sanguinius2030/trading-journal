import type { Trade } from '../types';
import {
  supabase,
  getSymbolFromMarketId,
  upsertTrades,
  getTradesFromDB,
  getLatestTradeId,
  type DBTrade
} from './supabase';

// Lighter API configuration
const LIGHTER_WALLET_ADDRESS = import.meta.env.VITE_LIGHTER_WALLET_ADDRESS || '';
const LIGHTER_AUTH_TOKEN = import.meta.env.VITE_LIGHTER_AUTH_TOKEN || '';
const LIGHTER_ACCOUNT_INDEX = import.meta.env.VITE_LIGHTER_ACCOUNT_INDEX || '132275';

/**
 * Fetch trade history from Lighter API
 */
async function fetchTradeHistoryFromAPI(limit: number = 100): Promise<any[]> {
  const response = await fetch(
    `/api/lighter-proxy?endpoint=trades&sort_by=timestamp&limit=${limit}&account_index=${LIGHTER_ACCOUNT_INDEX}&auth=${LIGHTER_AUTH_TOKEN}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch trades: ${response.status}`);
  }

  const data = await response.json();
  return data.trades || [];
}

/**
 * Transform Lighter API trade to database format
 */
function transformToDBTrade(trade: any): Partial<DBTrade> {
  const isBuy = trade.bid_account_id === parseInt(LIGHTER_ACCOUNT_INDEX);
  // Lighter timestamp is in milliseconds
  const timestamp = new Date(Number(trade.timestamp)).toISOString();

  return {
    id: `lighter-${trade.trade_id}`,
    trade_id: trade.trade_id,
    symbol: getSymbolFromMarketId(trade.market_id),
    market_id: trade.market_id,
    type: isBuy ? 'long' : 'short',
    status: 'closed',
    side: isBuy ? 'BUY' : 'SELL',
    entry_price: parseFloat(trade.price),
    quantity: parseFloat(trade.size),
    usd_amount: parseFloat(trade.usd_amount),
    entry_date: timestamp,
    exchange: 'Lighter',
    raw_data: trade,
  };
}

/**
 * Transform database trade to app Trade format
 * Returns null if trade data is invalid
 */
function dbTradeToAppTrade(dbTrade: DBTrade): Trade | null {
  // Skip invalid trades
  if (!dbTrade || !dbTrade.id) {
    console.warn('Invalid trade data:', dbTrade);
    return null;
  }

  // Safely parse date - handle null/undefined
  const entryDate = dbTrade.entry_date ? new Date(dbTrade.entry_date) : new Date();
  const exitDate = dbTrade.exit_date ? new Date(dbTrade.exit_date) : undefined;

  // Ensure numeric values are numbers, not null
  const entryPrice = Number(dbTrade.entry_price) || 0;
  const quantity = Number(dbTrade.quantity) || 0;
  const exitPrice = dbTrade.exit_price != null ? Number(dbTrade.exit_price) : undefined;
  const pnl = dbTrade.pnl != null ? Number(dbTrade.pnl) : undefined;
  const pnlPercent = dbTrade.pnl_percent != null ? Number(dbTrade.pnl_percent) : undefined;

  return {
    id: dbTrade.id,
    symbol: dbTrade.symbol || 'UNKNOWN',
    type: dbTrade.type || 'long',
    status: dbTrade.status || 'closed',
    entryPrice,
    exitPrice,
    quantity,
    entryDate,
    exitDate,
    pnl,
    pnlPercent,
    notes: dbTrade.notes || undefined,
    reasoning: dbTrade.reasoning || undefined,
    tradeCategory: dbTrade.trade_category || undefined,
    exchange: (dbTrade.exchange as 'Lighter' | 'Hyperliquid') || 'Lighter',
  };
}

/**
 * Sync trades from Lighter API to database
 * Returns the number of new trades synced
 */
export async function syncTradesToDB(): Promise<number> {
  if (!supabase) {
    console.warn('Supabase not configured, skipping sync');
    return 0;
  }

  if (!LIGHTER_AUTH_TOKEN) {
    console.warn('Lighter auth token not configured');
    return 0;
  }

  try {
    console.log('Fetching trades from Lighter API...');
    const apiTrades = await fetchTradeHistoryFromAPI(100);
    console.log(`Fetched ${apiTrades.length} trades from API`);

    if (apiTrades.length === 0) return 0;

    // Get latest trade_id we already have
    const latestStoredId = await getLatestTradeId();
    console.log('Latest stored trade_id:', latestStoredId);

    // Filter to only new trades
    const newTrades = latestStoredId
      ? apiTrades.filter(t => t.trade_id > latestStoredId)
      : apiTrades;

    console.log(`Found ${newTrades.length} new trades to sync`);

    if (newTrades.length === 0) return 0;

    // Transform and upsert
    const dbTrades = newTrades.map(transformToDBTrade);
    await upsertTrades(dbTrades);

    console.log(`Synced ${newTrades.length} trades to database`);
    return newTrades.length;
  } catch (error) {
    console.error('Error syncing trades:', error);
    throw error;
  }
}

/**
 * Fetch all trades - first sync from API, then return from database
 */
export async function fetchLighterTrades(): Promise<Trade[]> {
  try {
    // Try to sync new trades from API
    if (LIGHTER_AUTH_TOKEN && supabase) {
      try {
        await syncTradesToDB();
      } catch (syncError) {
        console.warn('Failed to sync trades, using cached data:', syncError);
      }
    }

    // Return trades from database
    if (supabase) {
      const dbTrades = await getTradesFromDB();
      // Filter out any null results from invalid trades
      return dbTrades.map(dbTradeToAppTrade).filter((t): t is Trade => t !== null);
    }

    // Fallback: fetch directly from API if no database
    if (LIGHTER_AUTH_TOKEN) {
      const apiTrades = await fetchTradeHistoryFromAPI(100);
      return apiTrades.map((trade: any) => {
        const isBuy = trade.bid_account_id === parseInt(LIGHTER_ACCOUNT_INDEX);
        return {
          id: `lighter-${trade.trade_id}`,
          symbol: getSymbolFromMarketId(trade.market_id),
          type: isBuy ? 'long' : 'short',
          status: 'closed',
          entryPrice: parseFloat(trade.price),
          quantity: parseFloat(trade.size),
          entryDate: new Date(trade.timestamp),
          exchange: 'Lighter',
        } as Trade;
      });
    }

    return [];
  } catch (error) {
    console.error('Error fetching Lighter trades:', error);
    throw error;
  }
}

/**
 * Get user's wallet address from environment
 */
export function getWalletAddress(): string {
  return LIGHTER_WALLET_ADDRESS;
}

/**
 * Check if Lighter integration is configured
 */
export function isLighterConfigured(): boolean {
  return !!LIGHTER_AUTH_TOKEN || !!LIGHTER_WALLET_ADDRESS;
}

/**
 * Lighter API position data from explorer
 */
export interface LighterPosition {
  market_id: number;
  side: 'long' | 'short';
  size: string;
  entry_price: string;
  mark_price: string;
  liquidation_price: string;
  unrealized_pnl: string;
  margin: string;
  leverage: string;
  funding: string;
  position_value: string;
}

/**
 * Fetch open positions from Lighter explorer API
 */
export async function fetchOpenPositions(): Promise<LighterPosition[]> {
  if (!LIGHTER_ACCOUNT_INDEX) {
    console.warn('Lighter account index not configured');
    return [];
  }

  try {
    const response = await fetch(
      `/api/lighter-proxy?endpoint=accounts/${LIGHTER_ACCOUNT_INDEX}/positions`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to fetch positions: ${response.status}`);
    }

    const data = await response.json();
    console.log('Open positions from Lighter:', data);
    // The API returns positions array directly or nested
    return data.positions || data || [];
  } catch (error) {
    console.error('Error fetching open positions:', error);
    return [];
  }
}
