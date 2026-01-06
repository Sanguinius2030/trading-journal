export type TradeType = 'long' | 'short';
export type TradeStatus = 'open' | 'closed';

export interface Trade {
  id: string;
  symbol: string;
  type: TradeType;
  status: TradeStatus;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  entryDate: Date;
  exitDate?: Date;
  pnl?: number;
  pnlPercent?: number;
  notes?: string;
  reasoning?: string;
  tradeCategory?: string;
  exchange: 'Hyperliquid' | 'Lighter';
}

export interface PortfolioSnapshot {
  date: Date;
  totalValue: number;
  totalPnL: number;
}

export interface KPIMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  totalPnLPercent: number;
  averagePnL: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
  avgMonthlyGain: number;
  avgMonthlyGainPercent: number;
}

export interface Position {
  id: string;
  symbol: string;
  marketId?: number;
  side: 'LONG' | 'SHORT';
  status: 'open' | 'closed';

  totalQuantity: number;
  avgEntryPrice: number;
  avgExitPrice?: number;
  totalEntryCost: number;
  totalExitRevenue: number;

  realizedPnl?: number;
  realizedPnlPercent?: number;
  unrealizedPnl?: number;

  openedAt: Date;
  closedAt?: Date;

  journal?: string;
  category?: string;

  fillsCount: number;
  exchange: 'Lighter' | 'Hyperliquid';

  // For UI - linked fills
  fills?: Trade[];
}
