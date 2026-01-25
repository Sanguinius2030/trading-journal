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
  pnl: number | null;
  realized_pnl: number;  // For open positions: realized P&L from partial closes
  position_type: 'LONG' | 'SHORT';
  is_closed: boolean;
}

// Market symbols cache
let marketSymbols: Map<number, string> = new Map();

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
  const accountIndex = 132275;

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

          // Calculate PnL based on cash flows
          // For a SHORT position: we sell first, then buy back
          //   PnL = totalSellValue - totalBuyValue (positive if we sold high, bought low)
          // For a LONG position: we buy first, then sell
          //   PnL = totalSellValue - totalBuyValue (positive if we sold high after buying low)
          // Actually it's always: PnL = totalSellValue - totalBuyValue
          currentPosition.pnl = totalSellValue - totalBuyValue;
          currentPosition.realized_pnl = totalSellValue - totalBuyValue;

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
        // For LONG: realized PnL from partial sells = sellValue - (proportional buyValue)
        // Simplified: if we bought $1000 of 10 units, sold 3 units for $350, realized = $350 - ($1000 * 3/10) = $50
        if (totalSellSize > 0 && totalBuySize > 0) {
          const avgBuyPrice = totalBuyValue / totalBuySize;
          currentPosition.realized_pnl = totalSellValue - (totalSellSize * avgBuyPrice);
        }
      } else {
        currentPosition.avg_entry_price = totalSellSize > 0 ? totalSellValue / totalSellSize : 0;
        // For SHORT: realized PnL from partial buys = (proportional sellValue) - buyValue
        // Simplified: if we shorted $1000 of 10 units, bought back 3 units for $280, realized = ($1000 * 3/10) - $280 = $20
        if (totalBuySize > 0 && totalSellSize > 0) {
          const avgSellPrice = totalSellValue / totalSellSize;
          currentPosition.realized_pnl = (totalBuySize * avgSellPrice) - totalBuyValue;
        }
      }
      positions.push(currentPosition);
    }
  });

  return positions;
}

async function main() {
  try {
    // Load market symbols first
    await loadMarketSymbols();

    // Read the raw trades data
    const tradesPath = path.join(__dirname, '..', 'data', 'sdk-trades.json');
    const jsonData = JSON.parse(fs.readFileSync(tradesPath, 'utf-8'));
    const tradesData = jsonData.trades || jsonData;

    console.log(`\nLoaded ${tradesData.length} raw trades`);

    // Aggregate ALL trades into positions first
    const allPositions = aggregatePositions(tradesData);

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

    console.log(`\nTotal PnL from closed positions: $${totalPnL.toFixed(2)}`);

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
        console.log(`  PnL: $${pos.pnl?.toFixed(2)} (${pos.pnl! > 0 ? '✓' : '✗'})`);
      } else {
        console.log(`  Status: OPEN`);
      }
      console.log(`  Trades: ${pos.trades.length}`);
      console.log('');
    });

    // Save to file
    const outputPath = path.join(__dirname, '..', 'data', 'aggregated-positions.json');
    const outputData = JSON.stringify({ positions, summary: { total_pnl: totalPnL } }, null, 2);
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
