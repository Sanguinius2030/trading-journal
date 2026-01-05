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
