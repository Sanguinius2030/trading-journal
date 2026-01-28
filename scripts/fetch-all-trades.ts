/**
 * Fetch trades from Lighter API using cursor-based pagination
 * Supports incremental fetching - only fetches new trades since last sync
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { ApiClient, OrderApi, AccountApi } from '@oraichain/lighter-ts-sdk';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
const envPath = path.join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const envVars: Record<string, string> = {};
envContent.split(/\r?\n/).forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      envVars[match[1].trim()] = match[2].trim();
    }
  }
});

const LIGHTER_API_URL = envVars.VITE_LIGHTER_API_URL || 'https://mainnet.zklighter.elliot.ai';
const AUTH_TOKEN = envVars.VITE_LIGHTER_AUTH_TOKEN || '';
const ACCOUNT_INDEX = parseInt(envVars.VITE_LIGHTER_ACCOUNT_INDEX || '132275');

interface Trade {
  trade_id: number;
  timestamp: number;
  [key: string]: any;
}

interface Liquidation {
  id: number;
  type: string;
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

interface FundingPayment {
  funding_id: number;
  market_id: number;
  timestamp: number;
  change: string;  // USD amount: positive = received, negative = paid
  position_size: string;
  rate: string;
  position_side: 'long' | 'short';
}

interface StoredData {
  trades: Trade[];
  liquidations?: Liquidation[];
  funding?: FundingPayment[];
  metadata: {
    total_count: number;
    fetched_at: string;
    account_index: number;
    newest_trade_id?: number;
    newest_liquidation_id?: number;
    newest_funding_id?: number;
  };
}

async function fetchLiquidations(accountIndex: number, authToken: string, newestExistingId: number = 0): Promise<Liquidation[]> {
  const allLiquidations: Liquidation[] = [];
  let cursor: string | undefined = undefined;
  const BATCH_SIZE = 100;
  const MAX_ITERATIONS = 50;
  let iteration = 0;

  console.log('\n--- Fetching Liquidations ---');
  if (newestExistingId > 0) {
    console.log(`Looking for liquidations newer than ID ${newestExistingId}...`);
  }

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    const params = new URLSearchParams({
      account_index: String(accountIndex),
      limit: String(BATCH_SIZE),
    });
    if (cursor) {
      params.append('cursor', cursor);
    }

    const url = `${LIGHTER_API_URL}/api/v1/liquidations?${params.toString()}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': authToken,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.log(`  Liquidations API returned ${response.status}`);
        break;
      }

      const data = await response.json();
      const liquidations = data.liquidations || [];

      if (liquidations.length === 0) {
        console.log('  No more liquidations.');
        break;
      }

      console.log(`  Batch ${iteration}: received ${liquidations.length} liquidations`);

      // Filter out ones we already have
      const newLiquidations = liquidations.filter(
        (l: Liquidation) => l.id > newestExistingId
      );

      if (newLiquidations.length < liquidations.length) {
        console.log(`  Found ${liquidations.length - newLiquidations.length} we already have`);
      }

      allLiquidations.push(...newLiquidations);

      // If we got fewer new ones than the batch, we've caught up
      if (newLiquidations.length < liquidations.length) {
        break;
      }

      cursor = data.next_cursor;
      if (!cursor) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('  Error fetching liquidations:', error);
      break;
    }
  }

  console.log(`  Total new liquidations: ${allLiquidations.length}`);
  return allLiquidations;
}

async function fetchFunding(
  accountApi: AccountApi,
  accountIndex: number,
  authToken: string,
  newestExistingId: number = 0
): Promise<FundingPayment[]> {
  const allFunding: FundingPayment[] = [];
  const BATCH_SIZE = 100;
  const MAX_ITERATIONS = 100;

  console.log('\n--- Fetching Funding Payments ---');
  if (newestExistingId > 0) {
    console.log(`Looking for funding payments newer than ID ${newestExistingId}...`);
  }

  // Get all market IDs we need to fetch funding for
  // We'll fetch for markets 0 (ETH), 1 (BTC), and any others
  const marketIds = [0, 1, 77]; // ETH, BTC, XMR - add more as needed

  for (const marketId of marketIds) {
    let cursor: string | undefined = undefined;
    let iteration = 0;
    let marketFundingCount = 0;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      try {
        const response = await accountApi.positionFunding(
          authToken,
          accountIndex,
          marketId,
          BATCH_SIZE,
          'all',
          cursor
        );

        const payments = response.position_fundings || [];

        if (payments.length === 0) {
          break;
        }

        if (iteration === 1) {
          console.log(`  Market ${marketId}: fetching...`);
        }

        // Filter out ones we already have
        const newPayments = payments.filter(
          (p: any) => p.funding_id > newestExistingId
        );

        // Map to our interface (already matches API response)
        const mappedPayments: FundingPayment[] = newPayments.map((p: any) => ({
          funding_id: p.funding_id,
          market_id: p.market_id,
          timestamp: p.timestamp,
          change: p.change,
          position_size: p.position_size,
          rate: p.rate,
          position_side: p.position_side
        }));

        allFunding.push(...mappedPayments);
        marketFundingCount += mappedPayments.length;

        // If we got fewer new ones than the batch, we've caught up
        if (newPayments.length < payments.length) {
          break;
        }

        cursor = response.next_cursor;
        if (!cursor) {
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error: any) {
        if (error.status === 404 || error.message?.includes('not found')) {
          // No funding for this market, skip
          break;
        }
        console.error(`  Error fetching funding for market ${marketId}:`, error.message || error);
        break;
      }
    }

    if (marketFundingCount > 0) {
      console.log(`  Market ${marketId}: ${marketFundingCount} funding payments`);
    }
  }

  console.log(`  Total new funding payments: ${allFunding.length}`);
  return allFunding;
}

async function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  const dataFile = path.join(dataDir, 'sdk-trades.json');

  // Load existing trades if available
  let existingTrades: Trade[] = [];
  let existingLiquidations: Liquidation[] = [];
  let existingFunding: FundingPayment[] = [];
  let newestExistingTradeId = 0;
  let newestExistingLiquidationId = 0;
  let newestExistingFundingId = 0;

  if (existsSync(dataFile)) {
    try {
      const existingData: StoredData = JSON.parse(readFileSync(dataFile, 'utf-8'));
      existingTrades = existingData.trades || [];
      existingLiquidations = existingData.liquidations || [];
      existingFunding = existingData.funding || [];

      // Find the newest IDs we already have
      if (existingTrades.length > 0) {
        newestExistingTradeId = Math.max(...existingTrades.map(t => t.trade_id));
      }
      if (existingLiquidations.length > 0) {
        newestExistingLiquidationId = Math.max(...existingLiquidations.map(l => l.id));
      }
      if (existingFunding.length > 0) {
        newestExistingFundingId = Math.max(...existingFunding.map(f => f.funding_id));
      }

      console.log('='.repeat(80));
      console.log('INCREMENTAL TRADE SYNC');
      console.log('='.repeat(80));
      console.log(`Found ${existingTrades.length} existing trades`);
      console.log(`Found ${existingLiquidations.length} existing liquidations`);
      console.log(`Found ${existingFunding.length} existing funding payments`);
      console.log(`Newest existing trade ID: ${newestExistingTradeId}`);
      console.log(`Newest existing liquidation ID: ${newestExistingLiquidationId}`);
      console.log(`Newest existing funding ID: ${newestExistingFundingId}`);
      console.log(`Looking for new data...\n`);
    } catch (err) {
      console.log('Could not parse existing data, will fetch all');
    }
  } else {
    console.log('='.repeat(80));
    console.log('FULL TRADE SYNC (no existing data)');
    console.log('='.repeat(80));
  }

  console.log(`Account Index: ${ACCOUNT_INDEX}\n`);

  const apiClient = new ApiClient(LIGHTER_API_URL as any);
  const orderApi = new OrderApi(apiClient);
  const accountApi = new AccountApi(apiClient);

  const newTrades: Trade[] = [];
  const BATCH_SIZE = 100;
  const MAX_NEW_TRADES = 50000;
  let cursor: string | undefined = undefined;
  let iteration = 0;
  let reachedExistingData = false;

  try {
    while (newTrades.length < MAX_NEW_TRADES && !reachedExistingData) {
      iteration++;
      console.log(`\nBatch ${iteration}: Fetching ${BATCH_SIZE} trades...`);
      if (cursor) {
        console.log(`  Using cursor: ${cursor.substring(0, 30)}...`);
      }

      let response;
      let retries = 0;
      const maxRetries = 5;

      while (retries < maxRetries) {
        try {
          // Use the getTrades method with cursor support
          response = await orderApi.getTrades(
            AUTH_TOKEN,
            ACCOUNT_INDEX,
            BATCH_SIZE,
            'timestamp',  // sort_by
            undefined,    // market_id (undefined = all markets)
            undefined,    // order_index
            cursor,       // cursor for pagination
            undefined,    // from
            undefined     // ask_filter
          );
          break; // Success, exit retry loop
        } catch (err: any) {
          if (err.status === 429) {
            retries++;
            const waitTime = Math.pow(2, retries) * 1000; // Exponential backoff
            console.log(`  Rate limited. Waiting ${waitTime/1000}s before retry ${retries}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            throw err; // Re-throw non-rate-limit errors
          }
        }
      }

      if (!response) {
        console.log('  Max retries reached. Saving current progress...');
        break;
      }

      if (!response.trades || response.trades.length === 0) {
        console.log('  No more trades available.');
        break;
      }

      console.log(`  Received ${response.trades.length} trades`);
      console.log(`  First trade ID: ${response.trades[0].trade_id}`);
      console.log(`  Last trade ID: ${response.trades[response.trades.length - 1].trade_id}`);

      // Filter out trades we already have (trade_id <= newestExistingTradeId)
      const trulyNewTrades = response.trades.filter(
        (t: Trade) => t.trade_id > newestExistingTradeId
      );

      if (trulyNewTrades.length < response.trades.length) {
        console.log(`  Found ${response.trades.length - trulyNewTrades.length} trades we already have`);
        reachedExistingData = true;
      }

      if (trulyNewTrades.length > 0) {
        newTrades.push(...trulyNewTrades);
        console.log(`  Added ${trulyNewTrades.length} new trades (total new: ${newTrades.length})`);
      }

      // If we've reached existing data, no need to continue
      if (reachedExistingData) {
        console.log('  Reached existing data, stopping fetch.');
        break;
      }

      // Check for next cursor
      if (response.next_cursor) {
        cursor = response.next_cursor;
        console.log(`  Next cursor available: ${cursor.substring(0, 30)}...`);
      } else {
        console.log('  No more pages (no next_cursor)');
        break;
      }

      // If we got fewer than BATCH_SIZE, we've likely reached the end
      if (response.trades.length < BATCH_SIZE) {
        console.log('  Reached end of available trades (partial batch).');
        break;
      }

      // Longer delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    console.log('\n' + '='.repeat(80));
    console.log(`TRADES FETCH COMPLETE: ${newTrades.length} new trades fetched`);
    console.log('='.repeat(80));

    // Merge new trades with existing trades
    const allTrades = [...existingTrades, ...newTrades];

    // Remove duplicates (just in case) by trade_id
    const uniqueTrades = Array.from(
      new Map(allTrades.map(t => [t.trade_id, t])).values()
    );

    // Sort by timestamp (oldest first) for proper aggregation
    uniqueTrades.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Total trades after merge: ${uniqueTrades.length}`);

    // Get date range
    if (uniqueTrades.length > 0) {
      const oldestDate = new Date(uniqueTrades[0].timestamp);
      const newestDate = new Date(uniqueTrades[uniqueTrades.length - 1].timestamp);
      const newestTradeId = Math.max(...uniqueTrades.map(t => t.trade_id));
      console.log(`Date range: ${oldestDate.toISOString()} to ${newestDate.toISOString()}`);
      console.log(`Newest trade ID: ${newestTradeId}`);
    }

    // Fetch liquidations
    const newLiquidations = await fetchLiquidations(ACCOUNT_INDEX, AUTH_TOKEN, newestExistingLiquidationId);

    // Merge liquidations
    const allLiquidations = [...existingLiquidations, ...newLiquidations];
    const uniqueLiquidations = Array.from(
      new Map(allLiquidations.map(l => [l.id, l])).values()
    );
    uniqueLiquidations.sort((a, b) => a.executed_at - b.executed_at);

    console.log(`\nTotal liquidations after merge: ${uniqueLiquidations.length}`);

    // Fetch funding payments
    const newFunding = await fetchFunding(accountApi, ACCOUNT_INDEX, AUTH_TOKEN, newestExistingFundingId);

    // Merge funding
    const allFunding = [...existingFunding, ...newFunding];
    const uniqueFunding = Array.from(
      new Map(allFunding.map(f => [f.funding_id, f])).values()
    );
    uniqueFunding.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Total funding payments after merge: ${uniqueFunding.length}`);

    // Save all trades, liquidations, and funding
    const outputData: StoredData = {
      trades: uniqueTrades,
      liquidations: uniqueLiquidations,
      funding: uniqueFunding,
      metadata: {
        total_count: uniqueTrades.length,
        fetched_at: new Date().toISOString(),
        account_index: ACCOUNT_INDEX,
        newest_trade_id: uniqueTrades.length > 0
          ? Math.max(...uniqueTrades.map(t => t.trade_id))
          : 0,
        newest_liquidation_id: uniqueLiquidations.length > 0
          ? Math.max(...uniqueLiquidations.map(l => l.id))
          : 0,
        newest_funding_id: uniqueFunding.length > 0
          ? Math.max(...uniqueFunding.map(f => f.funding_id))
          : 0
      }
    };

    writeFileSync(
      dataFile,
      JSON.stringify(outputData, null, 2),
      'utf-8'
    );

    console.log(`\n✅ Saved ${uniqueTrades.length} trades, ${uniqueLiquidations.length} liquidations, and ${uniqueFunding.length} funding payments to data/sdk-trades.json`);
    if (newTrades.length === 0 && newLiquidations.length === 0 && newFunding.length === 0) {
      console.log('   (No new data found - already up to date)');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    process.exit(1);
  }
}

main();
