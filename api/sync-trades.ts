import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Supabase setup for server-side operations
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Fallback to env vars for backwards compatibility (local dev)
const LIGHTER_API_URL = process.env.VITE_LIGHTER_API_URL || 'https://mainnet.zklighter.elliot.ai';
const FALLBACK_AUTH_TOKEN = process.env.VITE_LIGHTER_AUTH_TOKEN || '';
const FALLBACK_ACCOUNT_INDEX = parseInt(process.env.VITE_LIGHTER_ACCOUNT_INDEX || '132275');

interface RawTrade {
  trade_id: number;
  timestamp: number;
  size: string;
  price: string;
  usd_amount: string;
  market_id: number;
  is_maker_ask: boolean;
  bid_account_id: number;
  ask_account_id: number;
  taker_position_size_before: string;
  taker_entry_quote_before: string;
  maker_position_size_before: string;
  maker_entry_quote_before: string;
}

interface AggregatedPosition {
  position_id: string;
  market_id: number;
  market_symbol: string;
  entry_time: number;
  exit_time: number | null;
  entry_date: string;
  exit_date: string | null;
  trades: Array<{
    trade_id: number;
    timestamp: number;
    date_time: string;
    side: 'BUY' | 'SELL';
    size: number;
    price: number;
    usd_amount: number;
    position_before: number;
    position_after: number;
  }>;
  max_position_size: number;
  avg_entry_price: number;
  avg_exit_price: number | null;
  total_entry_value: number;
  total_exit_value: number;
  total_size: number;
  pnl: number | null;
  total_fees: number;
  position_type: 'LONG' | 'SHORT';
  is_closed: boolean;
  trade_count: number;
}

interface UserSettings {
  user_id: string;
  lighter_account_index: number | null;
  lighter_auth_token: string | null;
  starting_capital: number;
}

// Market symbols - hardcoded for speed (can be fetched dynamically if needed)
const MARKET_SYMBOLS: Record<number, string> = {
  0: 'ETH',
  1: 'BTC',
  2: 'SOL',
  77: 'XMR',
};

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(',', '');
}

async function fetchMarketSymbols(): Promise<Record<number, string>> {
  try {
    const response = await fetch(`${LIGHTER_API_URL}/api/v1/order_book_details`);
    if (response.ok) {
      const data = await response.json();
      const markets: Record<number, string> = {};
      (data.order_book_details || []).forEach((m: any) => {
        markets[m.market_id] = m.symbol;
      });
      return { ...MARKET_SYMBOLS, ...markets };
    }
  } catch (error) {
    console.error('Could not fetch market symbols:', error);
  }
  return MARKET_SYMBOLS;
}

async function fetchAllTrades(accountIndex: number, authToken: string): Promise<RawTrade[]> {
  const allTrades: RawTrade[] = [];
  const BATCH_SIZE = 100;
  const MAX_TRADES = 10000;
  let cursor: string | undefined = undefined;

  console.log(`Fetching trades for account ${accountIndex}...`);

  while (allTrades.length < MAX_TRADES) {
    const params = new URLSearchParams({
      auth: authToken,
      account_index: accountIndex.toString(),
      limit: BATCH_SIZE.toString(),
      sort_by: 'timestamp',
    });
    if (cursor) {
      params.set('cursor', cursor);
    }

    const url = `${LIGHTER_API_URL}/api/v1/trades?${params}`;

    let response;
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        response = await fetch(url);
        if (response.status === 429) {
          retries++;
          const waitTime = Math.pow(2, retries) * 1000;
          console.log(`Rate limited. Waiting ${waitTime/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          break;
        }
      } catch (err) {
        retries++;
        if (retries >= maxRetries) throw err;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!response || !response.ok) {
      console.error('Failed to fetch trades:', response?.status);
      break;
    }

    const data = await response.json();

    if (!data.trades || data.trades.length === 0) {
      break;
    }

    allTrades.push(...data.trades);
    console.log(`Fetched ${allTrades.length} trades so far...`);

    if (data.next_cursor) {
      cursor = data.next_cursor;
    } else {
      break;
    }

    if (data.trades.length < BATCH_SIZE) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  allTrades.sort((a, b) => a.timestamp - b.timestamp);

  return allTrades;
}

function aggregatePositions(trades: RawTrade[], marketSymbols: Record<number, string>, accountIndex: number): AggregatedPosition[] {
  const positions: AggregatedPosition[] = [];

  const tradesByMarket = new Map<number, RawTrade[]>();
  trades.forEach(trade => {
    if (!tradesByMarket.has(trade.market_id)) {
      tradesByMarket.set(trade.market_id, []);
    }
    tradesByMarket.get(trade.market_id)!.push(trade);
  });

  tradesByMarket.forEach((marketTrades, marketId) => {
    marketTrades.sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      return a.trade_id - b.trade_id;
    });

    let currentPosition: AggregatedPosition | null = null;
    let maxAbsPosition = 0;
    let totalBuyValue = 0;
    let totalBuySize = 0;
    let totalSellValue = 0;
    let totalSellSize = 0;

    marketTrades.forEach(trade => {
      const isMaker = trade.is_maker_ask
        ? (trade.ask_account_id === accountIndex)
        : (trade.bid_account_id === accountIndex);

      const positionBefore = parseFloat(
        isMaker ? trade.maker_position_size_before : trade.taker_position_size_before
      );

      const tradeSize = parseFloat(trade.size);
      const tradePrice = parseFloat(trade.price);
      const tradeValue = parseFloat(trade.usd_amount) || (tradeSize * tradePrice);

      const isBuyer = trade.bid_account_id === accountIndex;
      const side: 'BUY' | 'SELL' = isBuyer ? 'BUY' : 'SELL';

      const positionChange = isBuyer ? tradeSize : -tradeSize;
      const positionAfter = positionBefore + positionChange;

      const tradeInfo = {
        trade_id: trade.trade_id,
        timestamp: trade.timestamp,
        date_time: formatDateTime(trade.timestamp),
        side,
        size: tradeSize,
        price: tradePrice,
        usd_amount: tradeValue,
        position_before: positionBefore,
        position_after: positionAfter
      };

      if (Math.abs(positionBefore) < 0.0001) {
        maxAbsPosition = Math.abs(positionAfter);
        totalBuyValue = 0;
        totalBuySize = 0;
        totalSellValue = 0;
        totalSellSize = 0;

        if (isBuyer) {
          totalBuyValue += tradeValue;
          totalBuySize += tradeSize;
        } else {
          totalSellValue += tradeValue;
          totalSellSize += tradeSize;
        }

        currentPosition = {
          position_id: `${marketId}-${trade.trade_id}`,
          market_id: marketId,
          market_symbol: marketSymbols[marketId] || `Market ${marketId}`,
          entry_time: trade.timestamp,
          exit_time: null,
          entry_date: formatDateTime(trade.timestamp),
          exit_date: null,
          trades: [tradeInfo],
          max_position_size: maxAbsPosition,
          avg_entry_price: tradePrice,
          avg_exit_price: null,
          total_entry_value: tradeValue,
          total_exit_value: 0,
          total_size: tradeSize,
          pnl: null,
          total_fees: 0,
          position_type: positionAfter > 0 ? 'LONG' : 'SHORT',
          is_closed: false,
          trade_count: 1
        };
      } else if (currentPosition) {
        currentPosition.trades.push(tradeInfo);
        currentPosition.trade_count++;

        if (isBuyer) {
          totalBuyValue += tradeValue;
          totalBuySize += tradeSize;
        } else {
          totalSellValue += tradeValue;
          totalSellSize += tradeSize;
        }

        const currentAbsPosition = Math.abs(positionAfter);
        if (currentAbsPosition > maxAbsPosition) {
          maxAbsPosition = currentAbsPosition;
        }
        currentPosition.max_position_size = maxAbsPosition;
        currentPosition.total_size = maxAbsPosition;

        if (Math.abs(positionAfter) < 0.0001) {
          currentPosition.exit_time = trade.timestamp;
          currentPosition.exit_date = formatDateTime(trade.timestamp);
          currentPosition.is_closed = true;
          currentPosition.pnl = totalSellValue - totalBuyValue;

          if (currentPosition.position_type === 'LONG') {
            currentPosition.total_entry_value = totalBuyValue;
            currentPosition.total_exit_value = totalSellValue;
            currentPosition.avg_entry_price = totalBuySize > 0 ? totalBuyValue / totalBuySize : 0;
            currentPosition.avg_exit_price = totalSellSize > 0 ? totalSellValue / totalSellSize : 0;
          } else {
            currentPosition.total_entry_value = totalSellValue;
            currentPosition.total_exit_value = totalBuyValue;
            currentPosition.avg_entry_price = totalSellSize > 0 ? totalSellValue / totalSellSize : 0;
            currentPosition.avg_exit_price = totalBuySize > 0 ? totalBuyValue / totalBuySize : 0;
          }

          positions.push(currentPosition);
          currentPosition = null;
        }
      }
    });

    if (currentPosition) {
      if (currentPosition.position_type === 'LONG') {
        currentPosition.avg_entry_price = totalBuySize > 0 ? totalBuyValue / totalBuySize : 0;
      } else {
        currentPosition.avg_entry_price = totalSellSize > 0 ? totalSellValue / totalSellSize : 0;
      }
      positions.push(currentPosition);
    }
  });

  return positions;
}

async function getUserFromToken(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.error('Auth error:', error);
      return null;
    }
    return user.id;
  } catch (err) {
    console.error('Failed to verify token:', err);
    return null;
  }
}

async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Failed to get user settings:', error);
    return null;
  }

  return data as UserSettings;
}

interface AccountBalance {
  account_equity: number;
  available_balance: number;
  unrealized_pnl: number;
  margin_used: number;
}

async function fetchAccountBalance(accountIndex: number, authToken: string): Promise<AccountBalance | null> {
  try {
    const url = `${LIGHTER_API_URL}/api/v1/account?by=index&value=${accountIndex}&auth=${authToken}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error('Failed to fetch account balance:', response.status);
      return null;
    }

    const data = await response.json();
    const account = Array.isArray(data) ? data[0] : data;

    if (!account) {
      console.error('No account data returned');
      return null;
    }

    // Calculate total unrealized PnL from positions
    let totalUnrealizedPnl = 0;
    if (account.positions && account.positions.length > 0) {
      account.positions.forEach((pos: any) => {
        totalUnrealizedPnl += parseFloat(pos.unrealized_pnl || '0');
      });
    }

    return {
      account_equity: parseFloat(account.total_asset_value || account.collateral || '0'),
      available_balance: parseFloat(account.available_balance || '0'),
      unrealized_pnl: totalUnrealizedPnl,
      margin_used: parseFloat(account.margin_used || '0'),
    };
  } catch (error) {
    console.error('Error fetching account balance:', error);
    return null;
  }
}

async function saveAccountBalance(userId: string, balance: AccountBalance): Promise<void> {
  const { error } = await supabase
    .from('account_balances')
    .upsert({
      user_id: userId,
      account_equity: balance.account_equity,
      available_balance: balance.available_balance,
      unrealized_pnl: balance.unrealized_pnl,
      margin_used: balance.margin_used,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('Failed to save account balance:', error);
  } else {
    console.log('Saved account balance to Supabase');
  }
}

async function savePositionsToSupabase(userId: string, positions: AggregatedPosition[]): Promise<void> {
  // Prepare positions for upsert (remove trades array, it's too large)
  const positionsToSave = positions.map(pos => ({
    user_id: userId,
    position_id: pos.position_id,
    market_symbol: pos.market_symbol,
    position_type: pos.position_type,
    entry_time: pos.entry_time,
    exit_time: pos.exit_time,
    entry_date: pos.entry_date,
    exit_date: pos.exit_date,
    avg_entry_price: pos.avg_entry_price,
    avg_exit_price: pos.avg_exit_price,
    total_entry_value: pos.total_entry_value,
    total_exit_value: pos.total_exit_value,
    total_size: pos.total_size,
    pnl: pos.pnl,
    total_fees: pos.total_fees,
    is_closed: pos.is_closed,
    trade_count: pos.trade_count,
    updated_at: new Date().toISOString()
  }));

  // Upsert in batches of 100
  const batchSize = 100;
  for (let i = 0; i < positionsToSave.length; i += batchSize) {
    const batch = positionsToSave.slice(i, i + batchSize);
    const { error } = await supabase
      .from('positions')
      .upsert(batch, { onConflict: 'user_id,position_id' });

    if (error) {
      console.error(`Failed to save positions batch ${i / batchSize + 1}:`, error);
    }
  }

  console.log(`Saved ${positionsToSave.length} positions to Supabase`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting trade sync...');

    // Try to get authenticated user
    const userId = await getUserFromToken(req.headers.authorization);
    let accountIndex = FALLBACK_ACCOUNT_INDEX;
    let authToken = FALLBACK_AUTH_TOKEN;

    // If authenticated, get user's Lighter credentials
    if (userId && supabaseUrl && supabaseServiceKey) {
      console.log('User authenticated:', userId);
      const settings = await getUserSettings(userId);

      if (settings?.lighter_account_index && settings?.lighter_auth_token) {
        accountIndex = settings.lighter_account_index;
        authToken = settings.lighter_auth_token;
        console.log('Using user credentials for account:', accountIndex);
      } else {
        console.log('User has no Lighter credentials, using fallback');
      }
    } else {
      console.log('No auth or Supabase not configured, using fallback credentials');
    }

    // Validate we have credentials
    if (!authToken) {
      return res.status(400).json({
        error: 'No Lighter API credentials available. Please configure in Settings.'
      });
    }

    // Fetch market symbols
    const marketSymbols = await fetchMarketSymbols();
    console.log(`Loaded ${Object.keys(marketSymbols).length} market symbols`);

    // Fetch all trades
    const trades = await fetchAllTrades(accountIndex, authToken);
    console.log(`Fetched ${trades.length} total trades`);

    // Aggregate into positions
    const allPositions = aggregatePositions(trades, marketSymbols, accountIndex);

    // Filter to positions starting from Dec 19th, 2025 and exclude unknown markets
    const startDate = new Date('2025-12-19T00:00:00Z').getTime();
    const positions = allPositions.filter(p =>
      p.entry_time >= startDate &&
      !p.market_symbol.startsWith('Market ')
    );

    console.log(`Filtered to ${positions.length} positions (from ${allPositions.length} total)`);

    // If authenticated, save to Supabase
    if (userId && supabaseUrl && supabaseServiceKey) {
      await savePositionsToSupabase(userId, positions);

      // Also fetch and save account balance
      const balance = await fetchAccountBalance(accountIndex, authToken);
      if (balance) {
        await saveAccountBalance(userId, balance);
        console.log('Account balance:', balance);
      }
    }

    // Calculate total PnL
    const totalPnL = positions
      .filter(p => p.is_closed && p.pnl !== null)
      .reduce((sum, p) => sum + p.pnl!, 0);

    const result = {
      positions: positions.map(p => ({
        ...p,
        trades: undefined // Remove trades array from response to reduce size
      })),
      summary: {
        total_pnl: totalPnL,
        total_positions: positions.length,
        closed_positions: positions.filter(p => p.is_closed).length,
        open_positions: positions.filter(p => !p.is_closed).length,
        synced_at: new Date().toISOString()
      }
    };

    console.log('Sync complete:', result.summary);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
