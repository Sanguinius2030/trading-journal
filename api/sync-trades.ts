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
  // Fee fields (scaled integers, divide by 10000 to get USD)
  taker_fee?: number;
  maker_fee?: number;
  // Trade type: "trade" or "liquidation"
  type?: string;
  // Flag to identify liquidation-derived trades
  is_liquidation?: boolean;
}

interface RawLiquidation {
  id: number;
  type: string; // 'partial' or 'deleverage'
  market_id: number;
  trade: {
    price: string;
    size: string;
    taker_fee: string;
    maker_fee: string;
  };
  info: {
    positions: Array<{
      market_id: number;
      symbol: string;
      position: string;
    }>;
  };
  executed_at: number;
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
    fee: number;
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

async function fetchLiquidations(accountIndex: number, authToken: string): Promise<RawLiquidation[]> {
  const allLiquidations: RawLiquidation[] = [];
  const BATCH_SIZE = 100;
  const MAX_LIQUIDATIONS = 1000;
  let cursor: string | undefined = undefined;

  console.log(`Fetching liquidations for account ${accountIndex}...`);

  while (allLiquidations.length < MAX_LIQUIDATIONS) {
    const params = new URLSearchParams({
      auth: authToken,
      account_index: accountIndex.toString(),
      limit: BATCH_SIZE.toString(),
    });
    if (cursor) {
      params.set('cursor', cursor);
    }

    const url = `${LIGHTER_API_URL}/api/v1/liquidations?${params}`;

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
      console.error('Failed to fetch liquidations:', response?.status);
      break;
    }

    const data = await response.json();

    if (!data.liquidations || data.liquidations.length === 0) {
      break;
    }

    allLiquidations.push(...data.liquidations);
    console.log(`Fetched ${allLiquidations.length} liquidations so far...`);

    if (data.next_cursor) {
      cursor = data.next_cursor;
    } else {
      break;
    }

    if (data.liquidations.length < BATCH_SIZE) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`Total liquidations fetched: ${allLiquidations.length}`);
  return allLiquidations;
}

// Convert liquidations to synthetic trades for position aggregation
function liquidationsToTrades(liquidations: RawLiquidation[], accountIndex: number): RawTrade[] {
  return liquidations.map(liq => {
    // Find the position for this market to determine position state
    const marketPosition = liq.info.positions.find(p => p.market_id === liq.market_id);
    // The position in info.positions is the position AFTER the liquidation
    const positionAfter = marketPosition ? parseFloat(marketPosition.position) : 0;
    const size = parseFloat(liq.trade.size);
    const price = parseFloat(liq.trade.price);

    // Determine if this was a long or short position being liquidated
    // If positionAfter is positive (long), we were liquidated by selling, so we were even more long before
    // If positionAfter is negative (short), we were liquidated by buying, so we were even more short before
    const wasLong = positionAfter >= 0;
    const positionBefore = wasLong ? positionAfter + size : positionAfter - size;

    return {
      trade_id: liq.id + 900000000, // Offset to avoid ID collisions
      timestamp: liq.executed_at,
      size: liq.trade.size,
      price: liq.trade.price,
      usd_amount: String(size * price),
      market_id: liq.market_id,
      // For a long being liquidated: we're selling (ask), so is_maker_ask depends on account
      // For a short being liquidated: we're buying (bid)
      is_maker_ask: wasLong, // If long, we're the ask (seller)
      bid_account_id: wasLong ? 0 : accountIndex, // If short liquidated, we're the buyer
      ask_account_id: wasLong ? accountIndex : 0, // If long liquidated, we're the seller
      taker_position_size_before: String(positionBefore),
      taker_entry_quote_before: '0', // Not available from liquidation data
      maker_position_size_before: '0',
      maker_entry_quote_before: '0',
      is_liquidation: true,
    };
  });
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
    let totalFees = 0;

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

      // Get fee - liquidations have a different fee structure (1% of trade value)
      // Regular trades: fee stored as scaled integer (divide by 10000 to get USD)
      // Liquidations: only the TAKER (liquidated party) pays 1% fee, not the counterparty (maker)
      const isLiquidation = trade.type === 'liquidation' || trade.is_liquidation;
      let tradeFee: number;
      if (isLiquidation && !isMaker) {
        // Only the taker (liquidated party) pays the 1% fee
        tradeFee = tradeValue * 0.01;
      } else if (isLiquidation && isMaker) {
        // Counterparty (maker) doesn't pay liquidation fee
        tradeFee = 0;
      } else {
        // Regular trade fees are scaled integers
        tradeFee = isMaker
          ? (trade.maker_fee || 0) / 10000
          : (trade.taker_fee || 0) / 10000;
      }

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
        fee: tradeFee,
        position_before: positionBefore,
        position_after: positionAfter
      };

      if (Math.abs(positionBefore) < 0.0001) {
        maxAbsPosition = Math.abs(positionAfter);
        totalBuyValue = 0;
        totalBuySize = 0;
        totalSellValue = 0;
        totalSellSize = 0;
        totalFees = tradeFee;

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
          total_fees: totalFees,
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

        // Track fees
        totalFees += tradeFee;
        currentPosition.total_fees = totalFees;

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
          // Subtract fees from P&L
          currentPosition.pnl = totalSellValue - totalBuyValue - totalFees;

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
    // Account endpoint - try without auth first (public data), then with auth
    let url = `${LIGHTER_API_URL}/api/v1/account?by=index&value=${accountIndex}`;
    console.log('Fetching account balance for index:', accountIndex);

    let response = await fetch(url);

    // If unauthorized, try with auth token
    if (response.status === 401 || response.status === 403) {
      console.log('Account endpoint requires auth, retrying with token...');
      url = `${LIGHTER_API_URL}/api/v1/account?by=index&value=${accountIndex}&auth=${encodeURIComponent(authToken)}`;
      response = await fetch(url);
    }

    if (!response.ok) {
      console.error('Failed to fetch account balance:', response.status, await response.text().catch(() => ''));
      return null;
    }

    const data = await response.json();
    console.log('Account API response:', JSON.stringify(data).slice(0, 500));

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

    // Log the fields we're parsing to debug
    console.log('Parsing balance fields:', {
      total_asset_value: account.total_asset_value,
      collateral: account.collateral,
      available_balance: account.available_balance,
      margin_used: account.margin_used
    });

    const balance = {
      account_equity: parseFloat(account.total_asset_value || account.collateral || '0'),
      available_balance: parseFloat(account.available_balance || account.collateral || '0'),
      unrealized_pnl: totalUnrealizedPnl,
      margin_used: parseFloat(account.margin_used || '0'),
    };

    console.log('Parsed balance:', balance);
    return balance;
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
      console.log('User settings:', settings ? {
        has_account_index: !!settings.lighter_account_index,
        account_index: settings.lighter_account_index,
        has_auth_token: !!settings.lighter_auth_token,
        auth_token_length: settings.lighter_auth_token?.length || 0
      } : 'null');

      if (settings?.lighter_account_index && settings?.lighter_auth_token) {
        accountIndex = settings.lighter_account_index;
        authToken = settings.lighter_auth_token;
        console.log('Using user credentials for account:', accountIndex);
      } else {
        console.log('User has no Lighter credentials, using fallback');
        console.log('Fallback account index:', FALLBACK_ACCOUNT_INDEX);
        console.log('Fallback auth token available:', !!FALLBACK_AUTH_TOKEN, 'length:', FALLBACK_AUTH_TOKEN?.length || 0);
      }
    } else {
      console.log('No auth or Supabase not configured, using fallback credentials');
      console.log('Fallback account index:', FALLBACK_ACCOUNT_INDEX);
      console.log('Fallback auth token available:', !!FALLBACK_AUTH_TOKEN, 'length:', FALLBACK_AUTH_TOKEN?.length || 0);
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

    // Note: The /trades endpoint already includes liquidations as regular trades.
    // We fetch liquidation data for informational purposes but don't convert them
    // to synthetic trades as that would cause double-counting.
    const liquidations = await fetchLiquidations(accountIndex, authToken);
    console.log(`Fetched ${liquidations.length} liquidations (already included in trade data)`);

    // Aggregate into positions (trades already include liquidation events)
    const allPositions = aggregatePositions(trades, marketSymbols, accountIndex);
    console.log(`Aggregated ${allPositions.length} positions from ${trades.length} trades`);

    // Filter to positions starting from Dec 19th, 2025 and exclude unknown markets
    const startDate = new Date('2025-12-19T00:00:00Z').getTime();
    const beforeFilter = allPositions.length;
    const afterDateFilter = allPositions.filter(p => p.entry_time >= startDate).length;
    const afterMarketFilter = allPositions.filter(p => !p.market_symbol.startsWith('Market ')).length;

    const positions = allPositions.filter(p =>
      p.entry_time >= startDate &&
      !p.market_symbol.startsWith('Market ')
    );

    console.log(`Filtering: total=${beforeFilter}, after date filter=${afterDateFilter}, after market filter=${afterMarketFilter}, final=${positions.length}`);
    console.log(`Date filter: positions after ${new Date(startDate).toISOString()}`);

    // Log first and last position dates for debugging
    if (allPositions.length > 0) {
      const sortedByEntry = [...allPositions].sort((a, b) => a.entry_time - b.entry_time);
      console.log(`Earliest position: ${new Date(sortedByEntry[0].entry_time).toISOString()}`);
      console.log(`Latest position: ${new Date(sortedByEntry[sortedByEntry.length - 1].entry_time).toISOString()}`);
    }

    // If authenticated, save to Supabase
    if (userId && supabaseUrl && supabaseServiceKey) {
      console.log('Saving data to Supabase for user:', userId);
      await savePositionsToSupabase(userId, positions);

      // Also fetch and save account balance
      console.log('Fetching account balance for account:', accountIndex);
      const balance = await fetchAccountBalance(accountIndex, authToken);
      if (balance) {
        console.log('Saving account balance to Supabase:', balance);
        await saveAccountBalance(userId, balance);
      } else {
        console.error('Balance fetch returned null - not saving to Supabase');
      }
    } else {
      console.log('Not saving to Supabase:', {
        hasUserId: !!userId,
        hasSupabaseUrl: !!supabaseUrl,
        hasServiceKey: !!supabaseServiceKey
      });
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
