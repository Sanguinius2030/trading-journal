import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Database features will be disabled.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export interface DBTrade {
  id: string;
  trade_id: number;
  symbol: string;
  market_id: number;
  type: 'long' | 'short';
  status: 'open' | 'closed';
  side: 'BUY' | 'SELL';
  entry_price: number;
  exit_price?: number;
  quantity: number;
  usd_amount: number;
  entry_date: string;
  exit_date?: string;
  pnl?: number;
  pnl_percent?: number;
  fee?: number;
  notes?: string;
  reasoning?: string;
  trade_category?: string;
  exchange: string;
  raw_data?: any;
  created_at: string;
  updated_at: string;
}

// Market ID to Symbol mapping
export const MARKET_SYMBOLS: Record<number, string> = {
  0: 'ETH',
  1: 'BTC',
  2: 'SOL',
  3: 'DOGE',
  7: 'XRP',
  9: 'AVAX',
  16: 'SUI',
  21: 'FARTCOIN',
  24: 'HYPE',
  25: 'BNB',
  29: 'ENA',
  32: 'SEI',
  39: 'ADA',
  45: 'PUMP',
  47: 'PENGU',
  49: 'EIGEN',
  58: 'BCH',
  71: 'XPL',
  83: 'ASTER',
  90: 'ZEC',
  120: 'LIT',
};

export function getSymbolFromMarketId(marketId: number): string {
  return MARKET_SYMBOLS[marketId] || `MKT-${marketId}`;
}

// Fetch all trades from database
export async function getTradesFromDB(): Promise<DBTrade[]> {
  if (!supabase) {
    console.warn('Supabase not configured');
    return [];
  }

  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .order('entry_date', { ascending: false });

  if (error) {
    console.error('Error fetching trades from DB:', error);
    throw error;
  }

  return data || [];
}

// Insert or update trades in database
export async function upsertTrades(trades: Partial<DBTrade>[]): Promise<void> {
  if (!supabase || trades.length === 0) return;

  const { error } = await supabase
    .from('trades')
    .upsert(trades, {
      onConflict: 'trade_id',
      ignoreDuplicates: false
    });

  if (error) {
    console.error('Error upserting trades:', error);
    throw error;
  }
}

// Get the latest trade_id we have stored
export async function getLatestTradeId(): Promise<number | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('trades')
    .select('trade_id')
    .order('trade_id', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
    console.error('Error getting latest trade_id:', error);
    return null;
  }

  return data?.trade_id || null;
}

// Update trade notes
export async function updateTradeNotes(tradeId: string, notes: string, reasoning?: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from('trades')
    .update({ notes, reasoning, updated_at: new Date().toISOString() })
    .eq('id', tradeId);

  if (error) {
    console.error('Error updating trade notes:', error);
    throw error;
  }
}

// ==================== POSITIONS ====================

export interface DBPosition {
  id: string;
  symbol: string;
  market_id?: number;
  side: 'LONG' | 'SHORT';
  status: 'open' | 'closed';
  total_quantity: number;
  avg_entry_price?: number;
  avg_exit_price?: number;
  total_entry_cost: number;
  total_exit_revenue: number;
  realized_pnl?: number;
  realized_pnl_percent?: number;
  unrealized_pnl?: number;
  opened_at?: string;
  closed_at?: string;
  journal?: string;
  category?: string;
  fills_count: number;
  exchange: string;
  created_at: string;
  updated_at: string;
}

// Fetch all positions from database
export async function getPositionsFromDB(): Promise<DBPosition[]> {
  if (!supabase) {
    console.warn('Supabase not configured');
    return [];
  }

  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .order('opened_at', { ascending: false });

  if (error) {
    console.error('Error fetching positions from DB:', error);
    throw error;
  }

  return data || [];
}

// Create a new position
export async function createPosition(position: Partial<DBPosition>): Promise<DBPosition | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('positions')
    .insert(position)
    .select()
    .single();

  if (error) {
    console.error('Error creating position:', error);
    throw error;
  }

  return data;
}

// Update position (for journal/category edits)
export async function updatePosition(
  positionId: string,
  updates: Partial<Pick<DBPosition, 'journal' | 'category' | 'status' | 'closed_at' | 'avg_exit_price' | 'total_exit_revenue' | 'realized_pnl' | 'realized_pnl_percent' | 'total_quantity' | 'fills_count'>>
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from('positions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', positionId);

  if (error) {
    console.error('Error updating position:', error);
    throw error;
  }
}

// Upsert positions (create or update)
export async function upsertPositions(positions: Partial<DBPosition>[]): Promise<void> {
  if (!supabase || positions.length === 0) return;

  const { error } = await supabase
    .from('positions')
    .upsert(positions, {
      onConflict: 'id',
      ignoreDuplicates: false
    });

  if (error) {
    console.error('Error upserting positions:', error);
    throw error;
  }
}

// Link a trade to a position
export async function linkTradeToPosition(tradeId: string, positionId: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from('trades')
    .update({ position_id: positionId })
    .eq('id', tradeId);

  if (error) {
    console.error('Error linking trade to position:', error);
    throw error;
  }
}

// Get trades for a specific position
export async function getTradesForPosition(positionId: string): Promise<DBTrade[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('position_id', positionId)
    .order('entry_date', { ascending: true });

  if (error) {
    console.error('Error fetching trades for position:', error);
    throw error;
  }

  return data || [];
}
