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
  4: 'LINK',
  5: 'ARB',
  6: 'OP',
  7: 'XRP',
  8: 'MATIC',
  9: 'AVAX',
  10: 'NEAR',
  11: 'ATOM',
  12: 'FTM',
  13: 'APT',
  14: 'INJ',
  15: 'TIA',
  16: 'SUI',
  17: 'STX',
  18: 'IMX',
  19: 'RNDR',
  20: 'FET',
  21: 'FARTCOIN',
  22: 'WIF',
  23: 'BONK',
  24: 'HYPE',
  25: 'BNB',
  26: 'PEPE',
  27: 'SHIB',
  28: 'FLOKI',
  29: 'ENA',
  30: 'JUP',
  31: 'PYTH',
  32: 'SEI',
  33: 'BLUR',
  34: 'STRK',
  35: 'MANTA',
  36: 'DYM',
  37: 'JTO',
  38: 'ORDI',
  39: 'ADA',
  40: 'DOT',
  41: 'TRX',
  42: 'LTC',
  43: 'BCH',
  44: 'ETC',
  45: 'PUMP',
  46: 'XMR',
  47: 'PENGU',
  48: 'MKR',
  49: 'EIGEN',
  50: 'AAVE',
  51: 'UNI',
  52: 'CRV',
  53: 'LDO',
  54: 'SNX',
  55: 'COMP',
  56: 'GMX',
  57: 'DYDX',
  58: 'BCH',
  59: 'FIL',
  60: 'ICP',
  61: 'RUNE',
  62: 'THETA',
  63: 'GALA',
  64: 'AXS',
  65: 'SAND',
  66: 'MANA',
  67: 'APE',
  68: 'BLUR',
  69: 'ENS',
  70: 'WLD',
  71: 'XPL',
  72: 'AI16Z',
  73: 'VIRTUAL',
  74: 'GRIFFAIN',
  75: 'ZEREBRO',
  76: 'ARC',
  77: 'AIXBT',
  78: 'GOAT',
  79: 'GRASS',
  80: 'ME',
  81: 'MOVE',
  82: 'USUAL',
  83: 'ASTER',
  84: 'SONIC',
  85: 'PNUT',
  86: 'ACT',
  87: 'MORPHO',
  88: 'SPX',
  89: 'POPCAT',
  90: 'ZEC',
  91: 'LINK',
  92: 'AERO',
  93: 'COOKIE',
  94: 'SWARMS',
  95: 'ONDO',
  96: 'XLM',
  97: 'TRUMP',
  98: 'MELANIA',
  99: 'ANIME',
  100: 'VINE',
  101: 'BERA',
  102: 'TST',
  103: 'IP',
  104: 'LAYER',
  105: 'KAITO',
  106: 'SHELL',
  107: 'NIL',
  108: 'B3',
  109: 'PI',
  110: 'BMT',
  111: 'FORM',
  112: 'WAL',
  113: 'BABY',
  114: 'GPS',
  115: 'RED',
  116: 'PARTI',
  117: 'PLUME',
  118: 'ZORA',
  119: 'SIGN',
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
  console.log('updatePosition called:', { positionId, updates, supabaseConfigured: !!supabase });

  if (!supabase) {
    console.error('Supabase not configured!');
    throw new Error('Database not configured');
  }

  const { data, error } = await supabase
    .from('positions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', positionId)
    .select();

  console.log('Supabase update result:', { data, error });

  if (error) {
    console.error('Error updating position:', error);
    throw error;
  }

  if (!data || data.length === 0) {
    console.warn('No rows updated - position may not exist in database yet');
  }
}

// Upsert positions (create or update)
export async function upsertPositions(positions: Partial<DBPosition>[]): Promise<void> {
  console.log('upsertPositions called with', positions.length, 'positions');
  if (!supabase) {
    console.error('Supabase not configured for upsertPositions');
    return;
  }
  if (positions.length === 0) {
    console.log('No positions to upsert');
    return;
  }

  console.log('Upserting positions:', positions.map(p => ({ id: p.id, symbol: p.symbol, journal: p.journal, category: p.category })));

  const { data, error } = await supabase
    .from('positions')
    .upsert(positions, {
      onConflict: 'id',
      ignoreDuplicates: false
    })
    .select();

  console.log('Upsert result:', { data, error });

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
