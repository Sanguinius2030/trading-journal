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
    const response = await fetch(`${LIGHTER_API_URL.trim()}/api/v1/order_book_details`);
    if (response.ok) {
      const data = await response.json();
      const markets: Record<number, string> = {};
      (data.order_book_details || []).forEach((m: any) => {
        markets[m.market_id] = m.symbol;
      });
      console.log(`Fetched ${Object.keys(markets).length} market symbols from API`);
      return { ...MARKET_SYMBOLS, ...markets };
    }
    console.error('Market symbols API returned:', response.status);
  } catch (error) {
    console.error('Could not fetch market symbols:', error);
  }
  console.log('Using fallback market symbols (only 4 markets)');
  return MARKET_SYMBOLS;
}

async function fetchAllTrades(
  accountIndex: number,
  authToken: string,
  options?: { timeLimitMs?: number; sinceTimestamp?: number }
): Promise<{ trades: RawTrade[]; complete: boolean; batchCount: number; error?: string }> {
  const allTrades: RawTrade[] = [];
  const BATCH_SIZE = 100; // Lighter API rejects limit > 100
  const MAX_TRADES = 25000;
  const TIME_LIMIT = options?.timeLimitMs || 50000; // 50s default (leave 10s buffer for Vercel)
  const fetchStart = Date.now();
  const sinceTimestamp = options?.sinceTimestamp || 0;
  let cursor: string | undefined = undefined;
  let batchCount = 0;
  let complete = false;
  let fetchError: string | undefined;

  console.log(`Fetching trades for account ${accountIndex} (since: ${sinceTimestamp ? new Date(sinceTimestamp).toISOString() : 'all'})...`);

  while (allTrades.length < MAX_TRADES) {
    // Time guard: stop before Vercel timeout
    const elapsed = Date.now() - fetchStart;
    if (elapsed > TIME_LIMIT) {
      console.log(`Time limit reached after ${elapsed}ms, ${batchCount} batches, ${allTrades.length} trades`);
      break;
    }

    batchCount++;
    // Trim auth token and API URL to avoid whitespace issues from env vars
    const cleanAuth = authToken.trim();
    const cleanApiUrl = LIGHTER_API_URL.trim();
    let url = `${cleanApiUrl}/api/v1/trades?auth=${cleanAuth}&account_index=${accountIndex}&limit=${BATCH_SIZE}&sort_by=timestamp&start_time=${sinceTimestamp > 0 ? sinceTimestamp : 1}`;
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    // Log masked URL for debugging
    if (batchCount === 1) {
      const maskedUrl = url.replace(/auth=[^&]+/, `auth=${cleanAuth.substring(0, 6)}...${cleanAuth.substring(cleanAuth.length - 4)}`);
      console.log(`First batch URL: ${maskedUrl}`);
      console.log(`Auth token length: ${cleanAuth.length}, API URL: ${cleanApiUrl}`);
    }

    let response;
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
          }
        });
        if (response.status === 429) {
          retries++;
          const waitTime = Math.pow(2, retries) * 1000;
          console.log(`Rate limited on batch ${batchCount}. Waiting ${waitTime/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          break;
        }
      } catch (err) {
        retries++;
        console.error(`Fetch error on batch ${batchCount}, retry ${retries}:`, err instanceof Error ? err.message : err);
        if (retries >= maxRetries) throw err;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!response || !response.ok) {
      const status = response?.status;
      const text = response ? await response.text().catch(() => 'could not read body') : 'no response';
      // Include diagnostic info in the error
      fetchError = `API ${status} (auth_len=${cleanAuth.length}, acct=${accountIndex}, limit=${BATCH_SIZE}): ${text.substring(0, 150)}`;
      console.error(`Failed batch ${batchCount}: status=${status}, url_base=${cleanApiUrl}, body=${text.substring(0, 300)}`);
      break;
    }

    const data = await response.json();

    if (!data.trades || data.trades.length === 0) {
      console.log(`Batch ${batchCount}: empty response, all trades fetched`);
      complete = true;
      break;
    }

    // For incremental sync: API returns trades newest-first.
    // Filter to only trades newer than sinceTimestamp, and stop pagination
    // once we hit known (older) trades.
    if (sinceTimestamp > 0) {
      const newTrades = data.trades.filter((t: RawTrade) => t.timestamp > sinceTimestamp);
      const oldTradesFound = data.trades.length - newTrades.length;
      allTrades.push(...newTrades);

      if (oldTradesFound > 0) {
        console.log(`Batch ${batchCount}: reached known trades. Kept ${newTrades.length}/${data.trades.length} from this batch.`);
        complete = true;
        break;
      }
      console.log(`Batch ${batchCount}: ${newTrades.length} new trades (total: ${allTrades.length})`);
    } else {
      allTrades.push(...data.trades);
      if (batchCount % 10 === 0) {
        console.log(`Batch ${batchCount}: ${data.trades.length} trades (total: ${allTrades.length}), elapsed: ${Date.now() - fetchStart}ms`);
      }
    }

    // Only use cursor to determine if there are more pages
    if (data.next_cursor) {
      cursor = data.next_cursor;
    } else {
      complete = true;
      break;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  if (allTrades.length >= MAX_TRADES) {
    complete = true;
  }

  console.log(`Trade fetch: ${allTrades.length} trades in ${batchCount} batches, complete: ${complete}, error: ${fetchError || 'none'}, elapsed: ${Date.now() - fetchStart}ms`);
  allTrades.sort((a, b) => a.timestamp - b.timestamp);

  return { trades: allTrades, complete, batchCount, error: fetchError };
}

async function fetchLiquidations(accountIndex: number, authToken: string): Promise<RawLiquidation[]> {
  const allLiquidations: RawLiquidation[] = [];
  const BATCH_SIZE = 1000;
  const MAX_LIQUIDATIONS = 5000;
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
        response = await fetch(url, {
          headers: {
            'Authorization': authToken,
            'Accept': 'application/json',
          }
        });
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

    // Only use cursor for pagination - don't check response size vs BATCH_SIZE
    if (data.next_cursor) {
      cursor = data.next_cursor;
    } else {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 50));
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
    const url = `${LIGHTER_API_URL}/api/v1/account?by=index&value=${accountIndex}&auth=${encodeURIComponent(authToken)}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': authToken,
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      console.error('Failed to fetch account balance:', response.status);
      return null;
    }

    const data = await response.json();

    // Handle various API response formats:
    // Could be: array, { accounts: [...] }, { account: {...} }, or bare object
    let account: any;
    if (Array.isArray(data)) {
      account = data[0];
    } else if (data.accounts && Array.isArray(data.accounts)) {
      account = data.accounts[0];
    } else if (data.account) {
      account = data.account;
    } else {
      account = data;
    }

    // Log the response structure for debugging (no sensitive data)
    console.log('Account API response keys:', Object.keys(data), 'account keys:', account ? Object.keys(account).slice(0, 10) : 'null');

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

    const balance = {
      account_equity: parseFloat(account.total_asset_value || account.collateral || '0'),
      available_balance: parseFloat(account.available_balance || account.collateral || '0'),
      unrealized_pnl: totalUnrealizedPnl,
      margin_used: parseFloat(account.margin_used || '0'),
    };

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

// Get the timestamp to start fetching trades from (for incremental sync)
// Returns 0 if no existing data (full sync needed)
async function getSyncStartTime(userId: string): Promise<number> {
  // Check for open positions - we need to re-fetch their trades to properly re-aggregate
  const { data: openPositions } = await supabase
    .from('positions')
    .select('entry_time')
    .eq('user_id', userId)
    .eq('is_closed', false)
    .order('entry_time', { ascending: true })
    .limit(1);

  if (openPositions && openPositions.length > 0) {
    // Re-fetch from the earliest open position's entry time
    // Subtract 1ms so the > filter in fetchAllTrades includes trades at this exact timestamp
    const entryTime = openPositions[0].entry_time;
    console.log(`Found open position, syncing from entry_time: ${new Date(entryTime).toISOString()}`);
    return entryTime - 1;
  }

  // No open positions - fetch only new trades since the latest known position
  const { data: latestClosed } = await supabase
    .from('positions')
    .select('exit_time')
    .eq('user_id', userId)
    .eq('is_closed', true)
    .order('exit_time', { ascending: false })
    .limit(1);

  if (latestClosed && latestClosed.length > 0 && latestClosed[0].exit_time) {
    console.log(`Incremental sync from last exit_time: ${new Date(latestClosed[0].exit_time).toISOString()}`);
    return latestClosed[0].exit_time;
  }

  // No existing data - full sync needed
  console.log('No existing positions found, full sync needed');
  return 0;
}

// Fetch all positions from Supabase for the response (after incremental save)
async function getAllPositionsFromSupabase(userId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .order('entry_time', { ascending: false });

  if (error) {
    console.error('Failed to fetch positions from Supabase:', error);
    return [];
  }

  return data || [];
}

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://trading-journal-2026.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

function setCorsHeaders(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Require authentication
    const userId = await getUserFromToken(req.headers.authorization);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Rate limiting: max 1 sync per 30 seconds per user (incremental syncs are fast)
    if (supabaseUrl && supabaseServiceKey) {
      const { data: lastSync } = await supabase
        .from('positions')
        .select('updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (lastSync?.updated_at) {
        const lastSyncTime = new Date(lastSync.updated_at).getTime();
        const cooldownMs = 30 * 1000;
        const cooldownAgo = Date.now() - cooldownMs;
        if (lastSyncTime > cooldownAgo) {
          return res.status(429).json({
            error: 'Rate limited. Please wait before syncing again.',
            retry_after: Math.ceil((lastSyncTime - cooldownAgo) / 1000)
          });
        }
      }
    }

    console.log('Starting trade sync...');

    let accountIndex = FALLBACK_ACCOUNT_INDEX;
    let authToken = FALLBACK_AUTH_TOKEN;

    // Get user's Lighter credentials
    if (supabaseUrl && supabaseServiceKey) {
      const settings = await getUserSettings(userId);

      if (settings?.lighter_account_index && settings?.lighter_auth_token) {
        accountIndex = settings.lighter_account_index;
        authToken = settings.lighter_auth_token;
        console.log('Using user credentials for account:', accountIndex);
      } else {
        console.log('User has no Lighter credentials, using fallback');
      }
    }

    // Validate we have credentials
    if (!authToken) {
      return res.status(400).json({
        error: 'No Lighter API credentials available. Please configure in Settings.'
      });
    }

    const syncStart = Date.now();

    // Always fetch and update balance first (single API call, fast)
    const balance = await fetchAccountBalance(accountIndex, authToken);
    if (balance && userId && supabaseUrl && supabaseServiceKey) {
      await saveAccountBalance(userId, balance);
      console.log('Balance updated');
    }

    // Determine incremental sync start time from existing data
    let sinceTimestamp = 0;
    if (supabaseUrl && supabaseServiceKey) {
      sinceTimestamp = await getSyncStartTime(userId);
    }
    const isIncremental = sinceTimestamp > 0;
    console.log(`Sync mode: ${isIncremental ? 'incremental' : 'full'}`);

    // Fetch market symbols
    const marketSymbols = await fetchMarketSymbols();
    console.log(`Loaded ${Object.keys(marketSymbols).length} market symbols`);

    // Fetch trades (incremental: only new trades since last sync, fast!)
    // Don't pass startTime — let fetchAllTrades start its own timer so the
    // 45s budget isn't consumed by balance/settings/market symbol fetches above.
    const tradeResult = await fetchAllTrades(accountIndex, authToken, {
      timeLimitMs: 45000,
      sinceTimestamp,
    });
    const trades = tradeResult.trades;
    console.log(`Fetched ${trades.length} trades (complete: ${tradeResult.complete}, incremental: ${isIncremental})`);

    // If incremental sync returned 0 new trades, just return existing data
    if (isIncremental && trades.length === 0 && tradeResult.complete) {
      console.log('No new trades found - returning existing data from Supabase');
      const existingPositions = await getAllPositionsFromSupabase(userId);
      const totalPnL = existingPositions
        .filter(p => p.is_closed && p.pnl != null)
        .reduce((sum: number, p: any) => sum + parseFloat(p.pnl), 0);

      return res.status(200).json({
        positions: existingPositions,
        summary: {
          total_pnl: totalPnL,
          total_positions: existingPositions.length,
          closed_positions: existingPositions.filter((p: any) => p.is_closed).length,
          open_positions: existingPositions.filter((p: any) => !p.is_closed).length,
          total_trades_fetched: 0,
          fetch_complete: true,
          message: 'Already up to date - no new trades found.',
          synced_at: new Date().toISOString()
        }
      });
    }

    // For full sync that timed out with 0 trades, don't overwrite existing data
    if (!isIncremental && trades.length === 0 && !tradeResult.complete) {
      return res.status(200).json({
        positions: [],
        summary: {
          total_pnl: 0,
          total_positions: 0,
          closed_positions: 0,
          open_positions: 0,
          total_trades_fetched: 0,
          fetch_complete: false,
          message: 'Trade fetch timed out. Use the seed script to upload local data: npx tsx scripts/upload-to-supabase.ts',
          synced_at: new Date().toISOString()
        }
      });
    }

    // Aggregate new trades into positions
    const allPositions = aggregatePositions(trades, marketSymbols, accountIndex);
    console.log(`Aggregated ${allPositions.length} positions from ${trades.length} trades`);

    // Filter to positions starting from Dec 19th, 2025
    const startDate = new Date('2025-12-19T00:00:00Z').getTime();

    const newPositions = allPositions.filter(p => p.entry_time >= startDate);

    // Log details of all aggregated positions for debugging
    allPositions.forEach(p => {
      console.log(`  Position: ${p.market_symbol} ${p.position_type} ${p.is_closed ? 'CLOSED' : 'OPEN'} entry=${new Date(p.entry_time).toISOString()} trades=${p.trade_count}`);
    });
    console.log(`New positions after date filter: ${newPositions.length} (from ${allPositions.length} total)`);

    // Save new/updated positions to Supabase (upsert - won't delete existing)
    if (tradeResult.complete && userId && supabaseUrl && supabaseServiceKey) {
      if (newPositions.length > 0) {
        await savePositionsToSupabase(userId, newPositions);
        console.log(`Saved ${newPositions.length} new/updated positions to Supabase`);
      }
    } else if (!tradeResult.complete) {
      console.log('Skipping Supabase save - trade fetch was incomplete');
    }

    // Fetch ALL positions from Supabase for the response (existing + newly added)
    const allStoredPositions = await getAllPositionsFromSupabase(userId);

    // Calculate total PnL from all positions
    const totalPnL = allStoredPositions
      .filter((p: any) => p.is_closed && p.pnl != null)
      .reduce((sum: number, p: any) => sum + parseFloat(p.pnl), 0);

    const result = {
      positions: allStoredPositions,
      summary: {
        total_pnl: totalPnL,
        total_positions: allStoredPositions.length,
        closed_positions: allStoredPositions.filter((p: any) => p.is_closed).length,
        open_positions: allStoredPositions.filter((p: any) => !p.is_closed).length,
        total_trades_fetched: trades.length,
        new_positions: newPositions.length,
        fetch_complete: tradeResult.complete,
        message: tradeResult.complete
          ? (newPositions.length > 0
            ? `Synced ${newPositions.length} new position${newPositions.length === 1 ? '' : 's'}.`
            : undefined)
          : tradeResult.error
            ? `Sync failed: ${tradeResult.error}`
            : `Partial sync: fetched ${trades.length} trades in ${tradeResult.batchCount} batches before timeout.`,
        synced_at: new Date().toISOString()
      }
    };

    console.log(`Sync done in ${Date.now() - syncStart}ms:`, result.summary);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
