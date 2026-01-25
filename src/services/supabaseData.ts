import { supabase, isProduction, isSupabaseConfigured } from '../lib/supabase';

export interface Position {
  position_id: string;
  market_symbol: string;
  position_type: 'LONG' | 'SHORT';
  entry_time: number;
  exit_time: number | null;
  entry_date: string;
  exit_date: string | null;
  avg_entry_price: number;
  avg_exit_price: number | null;
  total_entry_value: number;
  total_exit_value: number;
  total_size: number;
  pnl: number | null;
  total_fees: number;
  is_closed: boolean;
  trade_count: number;
}

export interface AccountBalance {
  account_equity: number;
  available_balance: number;
  unrealized_pnl: number;
  margin_used: number;
  updated_at: string;
}

export interface PositionsData {
  positions: Position[];
  balance: AccountBalance | null;
  summary: {
    total_pnl: number;
    total_positions: number;
    closed_positions: number;
    open_positions: number;
  };
}

// Fetch positions from local JSON file (for local development)
export async function fetchPositionsFromJson(): Promise<PositionsData> {
  const [posResponse, balResponse] = await Promise.all([
    fetch('/aggregated-positions.json'),
    fetch('/data/account-balance.json').catch(() => null)
  ]);

  const posData = await posResponse.json();
  const positions = posData.positions || [];

  let balance: AccountBalance | null = null;
  if (balResponse?.ok) {
    const balData = await balResponse.json();
    balance = {
      account_equity: balData.account_equity || 0,
      available_balance: balData.available_balance || 0,
      unrealized_pnl: balData.unrealized_pnl || 0,
      margin_used: balData.margin_used || 0,
      updated_at: balData.updated_at || new Date().toISOString()
    };
  }

  const closedPositions = positions.filter((p: Position) => p.is_closed);
  const openPositions = positions.filter((p: Position) => !p.is_closed);
  const totalPnL = closedPositions.reduce((sum: number, p: Position) => sum + (p.pnl || 0), 0);

  return {
    positions,
    balance,
    summary: {
      total_pnl: totalPnL,
      total_positions: positions.length,
      closed_positions: closedPositions.length,
      open_positions: openPositions.length
    }
  };
}

// Fetch positions from Supabase (for production)
export async function fetchPositionsFromSupabase(accessToken: string): Promise<PositionsData> {
  const response = await fetch('/api/get-positions', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch positions: ${response.status}`);
  }

  return response.json();
}

// Smart fetch: use Supabase in production, JSON in development
export async function fetchPositions(accessToken?: string): Promise<PositionsData> {
  // In production with Supabase configured and an access token, use Supabase
  if (isProduction && isSupabaseConfigured && accessToken) {
    try {
      return await fetchPositionsFromSupabase(accessToken);
    } catch (error) {
      console.error('Failed to fetch from Supabase, falling back to JSON:', error);
      // Fall back to JSON
    }
  }

  // Default: fetch from local JSON files
  return fetchPositionsFromJson();
}

// Fetch position annotations from Supabase
export async function fetchAnnotations(userId?: string) {
  if (!isSupabaseConfigured) {
    return [];
  }

  const query = supabase
    .from('position_annotations')
    .select('*');

  // If we have a user_id, filter by it; otherwise use legacy account_index
  if (userId) {
    query.eq('user_id', userId);
  } else {
    query.eq('account_index', 132275);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch annotations:', error);
    return [];
  }

  return data || [];
}

// Fetch daily journals from Supabase
export async function fetchDailyJournals(userId?: string) {
  if (!isSupabaseConfigured) {
    return [];
  }

  const query = supabase
    .from('daily_journals')
    .select('*');

  if (userId) {
    query.eq('user_id', userId);
  } else {
    query.eq('account_index', 132275);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch daily journals:', error);
    return [];
  }

  return data || [];
}

// Fetch weekly journals from Supabase
export async function fetchWeeklyJournals(userId?: string) {
  if (!isSupabaseConfigured) {
    return [];
  }

  const query = supabase
    .from('weekly_journals')
    .select('*');

  if (userId) {
    query.eq('user_id', userId);
  } else {
    query.eq('account_index', 132275);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch weekly journals:', error);
    return [];
  }

  return data || [];
}

// Save position annotation to Supabase
export async function saveAnnotation(annotation: {
  position_id: string;
  category?: string;
  subcategory?: string;
  timeframe?: string;
  setup_thesis?: string;
  did_well?: string;
  could_improve?: string;
  emotions?: string;
  other_notes?: string;
}, userId?: string) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase not configured');
  }

  const data = {
    ...annotation,
    account_index: 132275,
    user_id: userId || null,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('position_annotations')
    .upsert(data, {
      onConflict: userId ? 'user_id,position_id' : 'position_id,account_index'
    });

  if (error) {
    throw error;
  }
}

// Save daily journal to Supabase
export async function saveDailyJournal(journal: {
  date: string;
  market_context?: string;
  daily_plan?: string;
  execution_review?: string;
  key_lessons?: string;
  emotions_summary?: string;
  rating?: number;
}, userId?: string) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase not configured');
  }

  const data = {
    ...journal,
    account_index: 132275,
    user_id: userId || null,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('daily_journals')
    .upsert(data, {
      onConflict: userId ? 'user_id,date' : 'date,account_index'
    });

  if (error) {
    throw error;
  }
}

// Save weekly journal to Supabase
export async function saveWeeklyJournal(journal: {
  week_start: string;
  week_end: string;
  weekly_goals?: string;
  market_overview?: string;
  performance_review?: string;
  biggest_wins?: string;
  biggest_lessons?: string;
  areas_to_improve?: string;
  next_week_focus?: string;
  rating?: number;
}, userId?: string) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase not configured');
  }

  const data = {
    ...journal,
    account_index: 132275,
    user_id: userId || null,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('weekly_journals')
    .upsert(data, {
      onConflict: userId ? 'user_id,week_start' : 'week_start,account_index'
    });

  if (error) {
    throw error;
  }
}
