import type { Trade, PortfolioSnapshot } from './types';

// Generate mock trades
export const mockTrades: Trade[] = [
  {
    id: '1',
    symbol: 'ETH/USD',
    type: 'long',
    status: 'closed',
    entryPrice: 2150,
    exitPrice: 2280,
    quantity: 5,
    entryDate: new Date('2025-11-05'),
    exitDate: new Date('2025-11-08'),
    pnl: 650,
    pnlPercent: 6.05,
    notes: 'Broke above resistance at 2100. Strong momentum on the daily chart.',
    reasoning: 'Technical breakout with strong volume confirmation',
    tradeCategory: 'Breakout',
    exchange: 'Hyperliquid'
  },
  {
    id: '2',
    symbol: 'BTC/USD',
    type: 'long',
    status: 'closed',
    entryPrice: 42000,
    exitPrice: 40500,
    quantity: 0.5,
    entryDate: new Date('2025-11-10'),
    exitDate: new Date('2025-11-12'),
    pnl: -750,
    pnlPercent: -3.57,
    notes: 'Failed to hold above support. Cut losses as planned.',
    reasoning: 'Expected bounce from support level',
    tradeCategory: 'Support/Resistance',
    exchange: 'Hyperliquid'
  },
  {
    id: '3',
    symbol: 'SOL/USD',
    type: 'long',
    status: 'closed',
    entryPrice: 95,
    exitPrice: 108,
    quantity: 20,
    entryDate: new Date('2025-11-15'),
    exitDate: new Date('2025-11-20'),
    pnl: 260,
    pnlPercent: 13.68,
    notes: 'Excellent momentum trade. Hit target 1 and moved stop to breakeven.',
    reasoning: 'Strong uptrend with increasing volume',
    tradeCategory: 'Momentum',
    exchange: 'Lighter'
  },
  {
    id: '4',
    symbol: 'AVAX/USD',
    type: 'short',
    status: 'closed',
    entryPrice: 38,
    exitPrice: 34.5,
    quantity: 30,
    entryDate: new Date('2025-11-22'),
    exitDate: new Date('2025-11-25'),
    pnl: 105,
    pnlPercent: 9.21,
    notes: 'Bearish divergence on 4h chart. Worked perfectly.',
    reasoning: 'Technical divergence signal',
    tradeCategory: 'Divergence',
    exchange: 'Lighter'
  },
  {
    id: '5',
    symbol: 'ETH/USD',
    type: 'long',
    status: 'closed',
    entryPrice: 2300,
    exitPrice: 2420,
    quantity: 4,
    entryDate: new Date('2025-11-28'),
    exitDate: new Date('2025-12-02'),
    pnl: 480,
    pnlPercent: 5.22,
    notes: 'Held through small pullback. Patience paid off.',
    reasoning: 'Continuation of uptrend',
    tradeCategory: 'Trend Following',
    exchange: 'Hyperliquid'
  },
  {
    id: '6',
    symbol: 'MATIC/USD',
    type: 'long',
    status: 'closed',
    entryPrice: 0.82,
    exitPrice: 0.94,
    quantity: 1000,
    entryDate: new Date('2025-12-05'),
    exitDate: new Date('2025-12-10'),
    pnl: 120,
    pnlPercent: 14.63,
    notes: 'News catalyst trade. Ecosystem upgrade announcement.',
    reasoning: 'Fundamental catalyst',
    tradeCategory: 'News/Catalyst',
    exchange: 'Lighter'
  },
  {
    id: '7',
    symbol: 'BTC/USD',
    type: 'long',
    status: 'closed',
    entryPrice: 43500,
    exitPrice: 45200,
    quantity: 0.3,
    entryDate: new Date('2025-12-12'),
    exitDate: new Date('2025-12-18'),
    pnl: 510,
    pnlPercent: 3.91,
    notes: 'Swing trade based on weekly timeframe setup.',
    reasoning: 'Higher timeframe trend continuation',
    tradeCategory: 'Swing Trade',
    exchange: 'Hyperliquid'
  },
  {
    id: '8',
    symbol: 'LINK/USD',
    type: 'long',
    status: 'open',
    entryPrice: 14.5,
    quantity: 50,
    entryDate: new Date('2025-12-28'),
    notes: 'Accumulation phase breakout. Targeting 18-20 range.',
    reasoning: 'Base breakout pattern',
    tradeCategory: 'Breakout',
    exchange: 'Lighter'
  },
  {
    id: '9',
    symbol: 'ARB/USD',
    type: 'long',
    status: 'open',
    entryPrice: 1.15,
    quantity: 500,
    entryDate: new Date('2026-01-02'),
    notes: 'L2 momentum play. Stop at 1.08.',
    reasoning: 'Sector rotation into L2 tokens',
    tradeCategory: 'Sector Play',
    exchange: 'Hyperliquid'
  }
];

// Calculate portfolio snapshots based on trades
export const generatePortfolioSnapshots = (): PortfolioSnapshot[] => {
  const startingCapital = 10000;
  const snapshots: PortfolioSnapshot[] = [];

  let currentValue = startingCapital;
  let totalPnL = 0;

  // Create daily snapshots from first trade to today
  const startDate = new Date('2025-11-01');
  const endDate = new Date();

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const currentDate = new Date(d);

    // Calculate PnL from all closed trades up to this date
    const closedTradesToDate = mockTrades.filter(trade =>
      trade.exitDate && trade.exitDate <= currentDate
    );

    totalPnL = closedTradesToDate.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
    currentValue = startingCapital + totalPnL;

    snapshots.push({
      date: new Date(currentDate),
      totalValue: currentValue,
      totalPnL: totalPnL
    });
  }

  return snapshots;
};

export const portfolioSnapshots = generatePortfolioSnapshots();
