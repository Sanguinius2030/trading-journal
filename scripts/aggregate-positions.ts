import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ApiClient, OrderApi } from '@oraichain/lighter-ts-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  taker_initial_margin_fraction_before: number;
  maker_position_size_before: string;
  maker_entry_quote_before: string;
  maker_initial_margin_fraction_before: number;
  taker_fee?: number;
  maker_fee?: number;
  type?: string;  // "trade" or "liquidation"
  is_liquidation?: boolean;
}

interface RawLiquidation {
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
  total_fees: number;  // Total trading fees paid
  total_funding: number;  // Funding payments (positive = received, negative = paid)
  pnl: number | null;
  realized_pnl: number;  // For open positions: realized P&L from partial closes
  position_type: 'LONG' | 'SHORT';
  is_closed: boolean;
}

// Market symbols cache
let marketSymbols: Map<number, string> = new Map();

const ACCOUNT_INDEX = 132275;

/**
 * Convert liquidations to synthetic trades for position aggregation
 */
function liquidationsToTrades(liquidations: RawLiquidation[]): RawTrade[] {
  return liquidations.map(liq => {
    // Find the position for this market to determine position before
    const marketPosition = liq.info.positions.find(p => p.market_id === liq.market_id);
    // The position in info.positions is the position AFTER the liquidation
    // We need to calculate position before
    const positionAfter = marketPosition ? parseFloat(marketPosition.position) : 0;
    const size = parseFloat(liq.trade.size);
    const price = parseFloat(liq.trade.price);
    const usdAmount = size * price;

    // If positionAfter is positive (long), we were liquidated by selling, so we were even more long before
    // If positionAfter is negative (short), we were liquidated by buying, so we were even more short before
    // If positionAfter is ~0, the liquidation closed our position
    const wasLong = positionAfter >= 0;
    const positionBefore = wasLong ? positionAfter + size : positionAfter - size;

    // Create a synthetic trade that represents the liquidation
    // Use negative trade_id to avoid conflicts with real trades
    const syntheticTrade: RawTrade = {
      trade_id: -liq.id, // Negative to avoid ID conflicts
      timestamp: liq.executed_at,
      size: liq.trade.size,
      price: liq.trade.price,
      usd_amount: String(usdAmount),
      market_id: liq.market_id,
      // Set up the trade direction based on position
      is_maker_ask: false, // We're always taker in liquidation
      // For long position liquidation: we're selling, so we're the ask (seller)
      // For short position liquidation: we're buying, so we're the bid (buyer)
      bid_account_id: wasLong ? 0 : ACCOUNT_INDEX,
      ask_account_id: wasLong ? ACCOUNT_INDEX : 0,
      // Position sizes
      taker_position_size_before: String(positionBefore),
      taker_entry_quote_before: '0',
      taker_initial_margin_fraction_before: 0,
      maker_position_size_before: '0',
      maker_entry_quote_before: '0',
      maker_initial_margin_fraction_before: 0,
      is_liquidation: true
    };

    return syntheticTrade;
  });
}

async function loadMarketSymbols(): Promise<void> {
  try {
    const client = new ApiClient('https://mainnet.zklighter.elliot.ai');
    const orderApi = new OrderApi(client);
    const details = await orderApi.getOrderBookDetails();

    const markets = (details as any).order_book_details || [];
    markets.forEach((m: any) => {
      marketSymbols.set(m.market_id, m.symbol);
    });
    console.log(`Loaded ${marketSymbols.size} market symbols`);
  } catch (error) {
    console.error('Warning: Could not load market symbols:', error);
    // Fallback to known markets
    marketSymbols.set(0, 'ETH');
    marketSymbols.set(77, 'XMR');
  }
}

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

function aggregatePositions(trades: RawTrade[]): AggregatedPosition[] {
  const positions: AggregatedPosition[] = [];
  const accountIndex = ACCOUNT_INDEX;

  // Group trades by market_id
  const tradesByMarket = new Map<number, RawTrade[]>();
  trades.forEach(trade => {
    if (!tradesByMarket.has(trade.market_id)) {
      tradesByMarket.set(trade.market_id, []);
    }
    tradesByMarket.get(trade.market_id)!.push(trade);
  });

  // Process each market separately
  tradesByMarket.forEach((marketTrades, marketId) => {
    // Sort by timestamp, then by trade_id for same-timestamp trades
    // Trade IDs are sequential and represent the actual order of execution
    marketTrades.sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      // Same timestamp: sort by trade_id (sequential execution order)
      return a.trade_id - b.trade_id;
    });

    let currentPosition: AggregatedPosition | null = null;
    let maxAbsPosition = 0;
    let totalBuyValue = 0;  // Total USD spent buying
    let totalBuySize = 0;   // Total size bought
    let totalSellValue = 0; // Total USD received selling
    let totalSellSize = 0;  // Total size sold
    let totalFees = 0;      // Total trading fees

    marketTrades.forEach(trade => {
      // Determine if we were maker or taker
      const isMaker = trade.is_maker_ask
        ? (trade.ask_account_id === accountIndex)
        : (trade.bid_account_id === accountIndex);

      // Get position size before this trade
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

      // Determine if we're buying or selling
      const isBuyer = trade.bid_account_id === accountIndex;
      const side: 'BUY' | 'SELL' = isBuyer ? 'BUY' : 'SELL';

      // Calculate position after
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

      // Check if this starts a new position (position_before was ~0)
      if (Math.abs(positionBefore) < 0.0001) {
        // Reset tracking variables for new position
        maxAbsPosition = Math.abs(positionAfter);
        totalBuyValue = 0;
        totalBuySize = 0;
        totalSellValue = 0;
        totalSellSize = 0;
        totalFees = tradeFee;

        // Track this trade
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
          market_symbol: marketSymbols.get(marketId) || `Market ${marketId}`,
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
          total_fees: totalFees,
          total_funding: 0,
          pnl: null,
          realized_pnl: 0,
          position_type: positionAfter > 0 ? 'LONG' : 'SHORT',
          is_closed: false
        };
      } else if (currentPosition) {
        // Add to existing position
        currentPosition.trades.push(tradeInfo);

        // Track buy/sell values
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

        // Update max position size
        const currentAbsPosition = Math.abs(positionAfter);
        if (currentAbsPosition > maxAbsPosition) {
          maxAbsPosition = currentAbsPosition;
        }
        currentPosition.max_position_size = maxAbsPosition;

        // Check if position is closed (position_after is ~0)
        if (Math.abs(positionAfter) < 0.0001) {
          currentPosition.exit_time = trade.timestamp;
          currentPosition.exit_date = formatDateTime(trade.timestamp);
          currentPosition.is_closed = true;

          // Calculate PnL based on cash flows minus fees
          // For a SHORT position: we sell first, then buy back
          //   PnL = totalSellValue - totalBuyValue - fees (positive if we sold high, bought low)
          // For a LONG position: we buy first, then sell
          //   PnL = totalSellValue - totalBuyValue - fees (positive if we sold high after buying low)
          // Always: PnL = totalSellValue - totalBuyValue - totalFees
          currentPosition.pnl = totalSellValue - totalBuyValue - totalFees;
          currentPosition.realized_pnl = totalSellValue - totalBuyValue - totalFees;

          // Calculate average entry and exit prices
          if (currentPosition.position_type === 'LONG') {
            // Long: entry is buying, exit is selling
            currentPosition.total_entry_value = totalBuyValue;
            currentPosition.total_exit_value = totalSellValue;
            currentPosition.avg_entry_price = totalBuySize > 0 ? totalBuyValue / totalBuySize : 0;
            currentPosition.avg_exit_price = totalSellSize > 0 ? totalSellValue / totalSellSize : 0;
          } else {
            // Short: entry is selling, exit is buying
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

    // If there's an unclosed position at the end, add it
    if (currentPosition) {
      // Calculate current average prices
      if (currentPosition.position_type === 'LONG') {
        currentPosition.avg_entry_price = totalBuySize > 0 ? totalBuyValue / totalBuySize : 0;
        // For LONG: realized PnL from partial sells = sellValue - (proportional buyValue) - fees
        // Simplified: if we bought $1000 of 10 units, sold 3 units for $350, realized = $350 - ($1000 * 3/10) - fees
        if (totalSellSize > 0 && totalBuySize > 0) {
          const avgBuyPrice = totalBuyValue / totalBuySize;
          currentPosition.realized_pnl = totalSellValue - (totalSellSize * avgBuyPrice) - totalFees;
        } else {
          // No partial closes yet, but still have fees from entry
          currentPosition.realized_pnl = -totalFees;
        }
      } else {
        currentPosition.avg_entry_price = totalSellSize > 0 ? totalSellValue / totalSellSize : 0;
        // For SHORT: realized PnL from partial buys = (proportional sellValue) - buyValue - fees
        // Simplified: if we shorted $1000 of 10 units, bought back 3 units for $280, realized = ($1000 * 3/10) - $280 - fees
        if (totalBuySize > 0 && totalSellSize > 0) {
          const avgSellPrice = totalSellValue / totalSellSize;
          currentPosition.realized_pnl = (totalBuySize * avgSellPrice) - totalBuyValue - totalFees;
        } else {
          // No partial closes yet, but still have fees from entry
          currentPosition.realized_pnl = -totalFees;
        }
      }
      positions.push(currentPosition);
    }
  });

  return positions;
}

/**
 * Calculate funding for each position based on funding payments within position's time range
 */
function applyFundingToPositions(positions: AggregatedPosition[], funding: FundingPayment[]): void {
  // Group funding by market_id for efficient lookup
  const fundingByMarket = new Map<number, FundingPayment[]>();
  funding.forEach(f => {
    if (!fundingByMarket.has(f.market_id)) {
      fundingByMarket.set(f.market_id, []);
    }
    fundingByMarket.get(f.market_id)!.push(f);
  });

  // Sort funding by timestamp within each market
  fundingByMarket.forEach(marketFunding => {
    marketFunding.sort((a, b) => a.timestamp - b.timestamp);
  });

  // For each position, find funding payments within its time range
  positions.forEach(pos => {
    const marketFunding = fundingByMarket.get(pos.market_id) || [];
    const entryTime = pos.entry_time;
    // For open positions, use current time; for closed, use exit time
    // Funding timestamps are in seconds, position timestamps are in milliseconds
    const exitTime = pos.exit_time || Date.now();

    let totalFunding = 0;
    marketFunding.forEach(f => {
      // Convert funding timestamp from seconds to milliseconds
      const fundingTimeMs = f.timestamp * 1000;
      if (fundingTimeMs >= entryTime && fundingTimeMs <= exitTime) {
        totalFunding += parseFloat(f.change);
      }
    });

    pos.total_funding = totalFunding;

    // Update PnL to include funding (funding received adds to profit, paid subtracts)
    if (pos.is_closed && pos.pnl !== null) {
      pos.pnl = pos.pnl + totalFunding;
      pos.realized_pnl = pos.realized_pnl + totalFunding;
    } else if (!pos.is_closed) {
      pos.realized_pnl = pos.realized_pnl + totalFunding;
    }
  });
}

async function main() {
  try {
    // Load market symbols first
    await loadMarketSymbols();

    // Read the raw trades data
    const tradesPath = path.join(__dirname, '..', 'data', 'sdk-trades.json');
    const jsonData = JSON.parse(fs.readFileSync(tradesPath, 'utf-8'));
    const tradesData: RawTrade[] = jsonData.trades || jsonData;
    const liquidationsData: RawLiquidation[] = jsonData.liquidations || [];
    const fundingData: FundingPayment[] = jsonData.funding || [];

    console.log(`\nLoaded ${tradesData.length} raw trades`);
    console.log(`Loaded ${liquidationsData.length} liquidations`);
    console.log(`Loaded ${fundingData.length} funding payments`);

    // Build a set of trade IDs that correspond to liquidations
    // by matching liquidation data (time, price, size) to trades
    const liquidationTradeIds = new Set<number>();
    liquidationsData.forEach(liq => {
      const liqTime = liq.executed_at;
      const liqPrice = parseFloat(liq.trade.price);
      const liqSize = parseFloat(liq.trade.size);

      // Find trades within 2 seconds of liquidation time with matching size
      // For "partial" liquidations: price matches
      // For "deleverage" liquidations: trade has price 0, match by exact time + size + market
      const matchingTrade = tradesData.find(t => {
        const timeDiff = Math.abs(t.timestamp - liqTime);
        const tradePrice = parseFloat(t.price);
        const sizeDiff = Math.abs(parseFloat(t.size) - liqSize);
        const sameMarket = t.market_id === liq.market_id;

        // For deleverage: exact timestamp, same market, same size, price is 0
        if (liq.type === 'deleverage') {
          return timeDiff < 100 && sameMarket && sizeDiff < 0.001 && tradePrice === 0;
        }

        // For partial: match by time, price, and size
        const priceDiff = Math.abs(tradePrice - liqPrice);
        return timeDiff < 2000 && priceDiff < 10 && sizeDiff < 0.001;
      });

      if (matchingTrade) {
        liquidationTradeIds.add(matchingTrade.trade_id);
        console.log(`  Matched ${liq.type} liquidation ${liq.id} -> trade ${matchingTrade.trade_id}`);
      } else {
        console.log(`  WARNING: No match for ${liq.type} liquidation ${liq.id}`);
      }
    });
    console.log(`Identified ${liquidationTradeIds.size} liquidation trades`);

    // Mark trades that are liquidations
    const allTrades = tradesData.map(t => ({
      ...t,
      is_liquidation: liquidationTradeIds.has(t.trade_id)
    }));

    // Aggregate ALL trades into positions first
    const allPositions = aggregatePositions(allTrades);

    // Apply funding to positions (calculates funding within each position's time range)
    applyFundingToPositions(allPositions, fundingData);
    const totalFundingApplied = allPositions.reduce((sum, p) => sum + p.total_funding, 0);
    console.log(`Applied funding to positions (total: $${totalFundingApplied.toFixed(2)})`);

    // Then filter to only include positions that STARTED on or after December 19th, 2025
    // Also filter out unknown/test markets (market_symbol starting with "Market ")
    const startDate = new Date('2025-12-19T00:00:00Z').getTime();
    const positions = allPositions.filter(p =>
      p.entry_time >= startDate &&
      !p.market_symbol.startsWith('Market ')
    );

    console.log(`\nFiltered to ${positions.length} positions starting from Dec 19th (from ${allPositions.length} total)`);

    console.log(`\nAggregated into ${positions.length} positions:`);
    console.log(`- Closed positions: ${positions.filter(p => p.is_closed).length}`);
    console.log(`- Open positions: ${positions.filter(p => !p.is_closed).length}`);

    // Calculate total PnL from closed positions
    const totalPnL = positions
      .filter(p => p.is_closed && p.pnl !== null)
      .reduce((sum, p) => sum + p.pnl!, 0);

    const totalFunding = positions
      .reduce((sum, p) => sum + p.total_funding, 0);

    console.log(`\nTotal PnL from closed positions: $${totalPnL.toFixed(2)}`);
    console.log(`Total funding received/paid: $${totalFunding.toFixed(2)}`);

    // Show summary of each position
    console.log('\n=== Position Summary ===\n');
    positions.forEach((pos, idx) => {
      console.log(`Position ${idx + 1}:`);
      console.log(`  Market: ${pos.market_symbol} (ID: ${pos.market_id})`);
      console.log(`  Type: ${pos.position_type}`);
      console.log(`  Max Size: ${pos.max_position_size.toFixed(4)} ${pos.market_symbol}`);
      console.log(`  Entry: ${pos.entry_date} @ $${pos.avg_entry_price.toFixed(2)}`);
      if (pos.is_closed) {
        console.log(`  Exit: ${pos.exit_date} @ $${pos.avg_exit_price?.toFixed(2)}`);
        console.log(`  Entry Value: $${pos.total_entry_value.toFixed(2)}`);
        console.log(`  Exit Value: $${pos.total_exit_value.toFixed(2)}`);
        console.log(`  Fees: $${pos.total_fees.toFixed(2)}`);
        if (pos.total_funding !== 0) {
          console.log(`  Funding: $${pos.total_funding.toFixed(2)}`);
        }
        console.log(`  PnL: $${pos.pnl?.toFixed(2)} (${pos.pnl! > 0 ? '✓' : '✗'})`);
      } else {
        console.log(`  Status: OPEN`);
        console.log(`  Fees paid: $${pos.total_fees.toFixed(2)}`);
        if (pos.total_funding !== 0) {
          console.log(`  Funding: $${pos.total_funding.toFixed(2)}`);
        }
      }
      console.log(`  Trades: ${pos.trades.length}`);
      console.log('');
    });

    // Save to file
    const outputPath = path.join(__dirname, '..', 'data', 'aggregated-positions.json');
    const outputData = JSON.stringify({ positions, summary: { total_pnl: totalPnL, total_funding: totalFunding } }, null, 2);
    fs.writeFileSync(outputPath, outputData);
    console.log(`\n✓ Saved aggregated positions to: ${outputPath}`);

    // Also copy to public folder for frontend access
    const publicPath = path.join(__dirname, '..', 'public', 'aggregated-positions.json');
    fs.writeFileSync(publicPath, outputData);
    console.log(`✓ Copied to public/aggregated-positions.json`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
