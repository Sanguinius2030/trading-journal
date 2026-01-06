import type { Trade, Position } from '../types';
import {
  getTradesFromDB,
  getPositionsFromDB,
  createPosition,
  updatePosition,
  linkTradeToPosition,
  getSymbolFromMarketId,
  type DBTrade,
  type DBPosition
} from './supabase';
import { fetchOpenPositions, type LighterPosition } from './lighterApi';

/**
 * Aggregates individual fills into positions based on open/close cycles.
 * A position closes when net quantity reaches 0, and a new position starts with subsequent trades.
 * For open positions, merges live data from Lighter API.
 */
export async function aggregateTradesIntoPositions(): Promise<Position[]> {
  // Get all trades and existing positions
  const dbTrades = await getTradesFromDB();
  const existingPositions = await getPositionsFromDB();

  // Fetch live position data from Lighter
  let livePositions = await fetchOpenPositions();
  // Ensure livePositions is always an array
  if (!Array.isArray(livePositions)) {
    console.warn('Live positions is not an array, resetting to empty array:', livePositions);
    livePositions = [];
  }
  console.log('Live positions from Lighter:', livePositions);

  // Group trades by symbol
  const tradesBySymbol = groupTradesBySymbol(dbTrades);

  const allPositions: Position[] = [];

  // Process each symbol
  for (const [symbol, trades] of Object.entries(tradesBySymbol)) {
    // Sort trades by date (oldest first)
    const sortedTrades = trades.sort((a, b) =>
      new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime()
    );

    // Calculate positions for this symbol
    const symbolPositions = calculatePositionsForSymbol(symbol, sortedTrades, existingPositions);

    // Merge live data for open positions
    for (const position of symbolPositions) {
      if (position.status === 'open') {
        const liveData = findLivePositionData(position, livePositions);
        if (liveData) {
          mergeWithLiveData(position, liveData);
        }
      }
    }

    allPositions.push(...symbolPositions);
  }

  // Sort all positions by opened date (newest first)
  allPositions.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());

  return allPositions;
}

/**
 * Find matching live position data from Lighter API
 */
function findLivePositionData(position: Position, livePositions: LighterPosition[]): LighterPosition | undefined {
  return livePositions.find(lp => {
    const liveSymbol = getSymbolFromMarketId(lp.market_id);
    const liveSide = lp.side.toUpperCase();
    return liveSymbol === position.symbol && liveSide === position.side;
  });
}

/**
 * Merge live data from Lighter API into position
 */
function mergeWithLiveData(position: Position, liveData: LighterPosition): void {
  position.positionSizeUsd = parseFloat(liveData.position_value) || undefined;
  position.currentPrice = parseFloat(liveData.mark_price) || undefined;
  position.liquidationPrice = parseFloat(liveData.liquidation_price) || undefined;
  position.margin = parseFloat(liveData.margin) || undefined;
  position.leverage = parseFloat(liveData.leverage) || undefined;
  position.funding = parseFloat(liveData.funding) || undefined;
  position.unrealizedPnl = parseFloat(liveData.unrealized_pnl) || undefined;
  position.totalQuantity = parseFloat(liveData.size) || position.totalQuantity;

  // Calculate unrealized P&L percent if we have the data
  if (position.unrealizedPnl !== undefined && position.margin && position.margin > 0) {
    position.unrealizedPnlPercent = (position.unrealizedPnl / position.margin) * 100;
  }
}

/**
 * Groups trades by symbol
 */
function groupTradesBySymbol(trades: DBTrade[]): Record<string, DBTrade[]> {
  return trades.reduce((acc, trade) => {
    const symbol = trade.symbol;
    if (!acc[symbol]) {
      acc[symbol] = [];
    }
    acc[symbol].push(trade);
    return acc;
  }, {} as Record<string, DBTrade[]>);
}

/**
 * Calculate positions for a single symbol based on its trades
 */
function calculatePositionsForSymbol(
  symbol: string,
  trades: DBTrade[],
  existingPositions: DBPosition[]
): Position[] {
  const positions: Position[] = [];
  let currentPosition: Partial<Position> | null = null;
  let runningQuantity = 0;
  let totalEntryCost = 0;
  let totalExitRevenue = 0;
  let realizedPnl = 0;
  let fillsCount = 0;
  let fills: Trade[] = [];

  for (const trade of trades) {
    const isBuy = trade.side === 'BUY';
    const quantity = Number(trade.quantity) || 0;
    const price = Number(trade.entry_price) || 0;
    const tradeValue = price * quantity;

    // Start a new position if none exists
    if (currentPosition === null) {
      currentPosition = {
        id: `pos-${symbol}-${trade.entry_date}`,
        symbol,
        marketId: trade.market_id,
        side: isBuy ? 'LONG' : 'SHORT',
        status: 'open',
        totalQuantity: 0,
        avgEntryPrice: 0,
        totalEntryCost: 0,
        totalExitRevenue: 0,
        realizedPnl: 0,
        openedAt: new Date(trade.entry_date),
        fillsCount: 0,
        exchange: (trade.exchange as 'Lighter' | 'Hyperliquid') || 'Lighter',
        fills: []
      };
      runningQuantity = 0;
      totalEntryCost = 0;
      totalExitRevenue = 0;
      realizedPnl = 0;
      fillsCount = 0;
      fills = [];
    }

    // Convert DBTrade to Trade for fills array
    const tradeFill: Trade = {
      id: trade.id,
      symbol: trade.symbol,
      type: trade.type || 'long',
      status: trade.status || 'closed',
      entryPrice: price,
      quantity,
      entryDate: new Date(trade.entry_date),
      exchange: (trade.exchange as 'Lighter' | 'Hyperliquid') || 'Lighter'
    };
    fills.push(tradeFill);
    fillsCount++;

    // Determine if this trade is adding to or reducing the position
    const isAddingToPosition =
      (currentPosition.side === 'LONG' && isBuy) ||
      (currentPosition.side === 'SHORT' && !isBuy);

    if (isAddingToPosition) {
      // Adding to position
      runningQuantity += quantity;
      totalEntryCost += tradeValue;
    } else {
      // Reducing position (taking profit or cutting loss)
      const avgEntry = totalEntryCost / runningQuantity;

      // Calculate realized P&L for this exit
      if (currentPosition.side === 'LONG') {
        realizedPnl += (price - avgEntry) * quantity;
      } else {
        realizedPnl += (avgEntry - price) * quantity;
      }

      totalExitRevenue += tradeValue;
      runningQuantity -= quantity;
    }

    // Check if position is closed (quantity = 0)
    if (runningQuantity <= 0.0001) { // Use small epsilon for floating point
      // Close the position
      const closedPosition: Position = {
        id: currentPosition.id!,
        symbol,
        marketId: currentPosition.marketId,
        side: currentPosition.side!,
        status: 'closed',
        totalQuantity: 0,
        avgEntryPrice: calculateWeightedAvgEntry(fills, currentPosition.side!),
        avgExitPrice: calculateWeightedAvgExit(fills, currentPosition.side!),
        totalEntryCost,
        totalExitRevenue,
        realizedPnl,
        realizedPnlPercent: totalEntryCost > 0 ? (realizedPnl / totalEntryCost) * 100 : 0,
        openedAt: currentPosition.openedAt!,
        closedAt: new Date(trade.entry_date),
        fillsCount,
        exchange: currentPosition.exchange!,
        fills: [...fills]
      };

      // Check if we have existing position data (for journal/category)
      const existingPos = existingPositions.find(p =>
        p.symbol === symbol &&
        p.opened_at &&
        Math.abs(new Date(p.opened_at).getTime() - closedPosition.openedAt.getTime()) < 1000
      );
      if (existingPos) {
        closedPosition.id = existingPos.id;
        closedPosition.journal = existingPos.journal || undefined;
        closedPosition.category = existingPos.category || undefined;
      }

      positions.push(closedPosition);

      // Reset for next position
      currentPosition = null;
      runningQuantity = 0;
    }
  }

  // If there's an open position remaining
  if (currentPosition !== null && runningQuantity > 0.0001) {
    const openPosition: Position = {
      id: currentPosition.id!,
      symbol,
      marketId: currentPosition.marketId,
      side: currentPosition.side!,
      status: 'open',
      totalQuantity: runningQuantity,
      avgEntryPrice: calculateWeightedAvgEntry(fills, currentPosition.side!),
      totalEntryCost,
      totalExitRevenue,
      realizedPnl,
      realizedPnlPercent: totalEntryCost > 0 ? (realizedPnl / totalEntryCost) * 100 : undefined,
      openedAt: currentPosition.openedAt!,
      fillsCount,
      exchange: currentPosition.exchange!,
      fills: [...fills]
    };

    // Check if we have existing position data
    const existingPos = existingPositions.find(p =>
      p.symbol === symbol &&
      p.status === 'open'
    );
    if (existingPos) {
      openPosition.id = existingPos.id;
      openPosition.journal = existingPos.journal || undefined;
      openPosition.category = existingPos.category || undefined;
    }

    positions.push(openPosition);
  }

  return positions;
}

/**
 * Calculate weighted average entry price based on fills
 */
function calculateWeightedAvgEntry(fills: Trade[], side: 'LONG' | 'SHORT'): number {
  const entryFills = fills.filter(f =>
    (side === 'LONG' && f.type === 'long') ||
    (side === 'SHORT' && f.type === 'short')
  );

  if (entryFills.length === 0) {
    // Fallback: use all fills that look like entries based on side
    const allEntries = side === 'LONG'
      ? fills.filter((_, i) => i % 2 === 0) // Assume alternating buy/sell
      : fills.filter((_, i) => i % 2 === 0);
    if (allEntries.length === 0) return fills[0]?.entryPrice || 0;

    const totalValue = allEntries.reduce((sum, f) => sum + f.entryPrice * f.quantity, 0);
    const totalQty = allEntries.reduce((sum, f) => sum + f.quantity, 0);
    return totalQty > 0 ? totalValue / totalQty : 0;
  }

  const totalValue = entryFills.reduce((sum, f) => sum + f.entryPrice * f.quantity, 0);
  const totalQty = entryFills.reduce((sum, f) => sum + f.quantity, 0);
  return totalQty > 0 ? totalValue / totalQty : 0;
}

/**
 * Calculate weighted average exit price based on fills
 */
function calculateWeightedAvgExit(fills: Trade[], side: 'LONG' | 'SHORT'): number | undefined {
  const exitFills = fills.filter(f =>
    (side === 'LONG' && f.type === 'short') ||
    (side === 'SHORT' && f.type === 'long')
  );

  if (exitFills.length === 0) return undefined;

  const totalValue = exitFills.reduce((sum, f) => sum + f.entryPrice * f.quantity, 0);
  const totalQty = exitFills.reduce((sum, f) => sum + f.quantity, 0);
  return totalQty > 0 ? totalValue / totalQty : undefined;
}

/**
 * Sync positions to database
 */
export async function syncPositionsToDatabase(positions: Position[]): Promise<void> {
  for (const position of positions) {
    const dbPosition: Partial<DBPosition> = {
      id: position.id,
      symbol: position.symbol,
      market_id: position.marketId,
      side: position.side,
      status: position.status,
      total_quantity: position.totalQuantity,
      avg_entry_price: position.avgEntryPrice,
      avg_exit_price: position.avgExitPrice,
      total_entry_cost: position.totalEntryCost,
      total_exit_revenue: position.totalExitRevenue,
      realized_pnl: position.realizedPnl,
      realized_pnl_percent: position.realizedPnlPercent,
      opened_at: position.openedAt.toISOString(),
      closed_at: position.closedAt?.toISOString(),
      journal: position.journal,
      category: position.category,
      fills_count: position.fillsCount,
      exchange: position.exchange
    };

    try {
      // Try to create or update
      await createPosition(dbPosition);
    } catch {
      // If creation fails (likely already exists), update instead
      await updatePosition(position.id, {
        status: position.status,
        total_quantity: position.totalQuantity,
        realized_pnl: position.realizedPnl,
        realized_pnl_percent: position.realizedPnlPercent,
        closed_at: position.closedAt?.toISOString(),
        fills_count: position.fillsCount
      });
    }

    // Link fills to position
    if (position.fills) {
      for (const fill of position.fills) {
        await linkTradeToPosition(fill.id, position.id);
      }
    }
  }
}

/**
 * Convert DB position to app Position type
 */
export function dbPositionToPosition(dbPos: DBPosition, fills?: Trade[]): Position {
  return {
    id: dbPos.id,
    symbol: dbPos.symbol,
    marketId: dbPos.market_id,
    side: dbPos.side,
    status: dbPos.status,
    totalQuantity: Number(dbPos.total_quantity) || 0,
    avgEntryPrice: Number(dbPos.avg_entry_price) || 0,
    avgExitPrice: dbPos.avg_exit_price ? Number(dbPos.avg_exit_price) : undefined,
    totalEntryCost: Number(dbPos.total_entry_cost) || 0,
    totalExitRevenue: Number(dbPos.total_exit_revenue) || 0,
    realizedPnl: dbPos.realized_pnl ? Number(dbPos.realized_pnl) : undefined,
    realizedPnlPercent: dbPos.realized_pnl_percent ? Number(dbPos.realized_pnl_percent) : undefined,
    unrealizedPnl: dbPos.unrealized_pnl ? Number(dbPos.unrealized_pnl) : undefined,
    openedAt: dbPos.opened_at ? new Date(dbPos.opened_at) : new Date(),
    closedAt: dbPos.closed_at ? new Date(dbPos.closed_at) : undefined,
    journal: dbPos.journal || undefined,
    category: dbPos.category || undefined,
    fillsCount: dbPos.fills_count || 0,
    exchange: (dbPos.exchange as 'Lighter' | 'Hyperliquid') || 'Lighter',
    fills
  };
}
