import { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Target, Activity, Flame, BarChart3,
  ArrowUpRight, ArrowDownRight
} from 'lucide-react';

interface Trade {
  trade_id: number;
  timestamp: number;
  date_time: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  usd_amount: number;
}

interface AggregatedPosition {
  position_id: string;
  market_symbol: string;
  entry_time: number;
  exit_time: number | null;
  entry_date: string;
  exit_date: string | null;
  trades: Trade[];
  max_position_size: number;
  avg_entry_price: number;
  avg_exit_price: number | null;
  total_entry_value: number;
  total_exit_value: number;
  pnl: number | null;
  position_type: 'LONG' | 'SHORT';
  is_closed: boolean;
}

interface PositionAnnotation {
  position_id: string;
  category?: string | null;
  subcategory?: string | null;
  timeframe?: string | null;
}

export function StatsTab() {
  const [positions, setPositions] = useState<AggregatedPosition[]>([]);
  const [annotations, setAnnotations] = useState<Map<string, PositionAnnotation>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/aggregated-positions.json');
        const data = await response.json();
        setPositions(data.positions || []);
      } catch (error) {
        console.error('Failed to load positions:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Load annotations from Supabase
  useEffect(() => {
    const loadAnnotations = async () => {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
        const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data, error } = await supabase
          .from('position_annotations')
          .select('position_id, category, subcategory, timeframe')
          .eq('account_index', 132275);

        if (error) throw error;

        const annotationsMap = new Map<string, PositionAnnotation>();
        data?.forEach(ann => {
          annotationsMap.set(ann.position_id, ann);
        });
        setAnnotations(annotationsMap);
      } catch (error) {
        console.error('Failed to load annotations:', error);
      }
    };
    loadAnnotations();
  }, []);

  const closedPositions = useMemo(() => {
    return positions.filter(p => p.is_closed && p.pnl !== null);
  }, [positions]);

  // Core KPIs
  const coreStats = useMemo(() => {
    if (closedPositions.length === 0) {
      return {
        totalPnL: 0, winRate: 0, profitFactor: 0, expectancy: 0,
        avgWin: 0, avgLoss: 0, largestWin: 0, largestLoss: 0,
        totalTrades: 0, winCount: 0, lossCount: 0,
        maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
        currentStreak: { count: 0, type: 'W' as const },
        currentDrawdown: 0, maxDrawdown: 0,
        avgHoldTime: 0, avgWinHoldTime: 0, avgLossHoldTime: 0,
      };
    }

    const sorted = [...closedPositions].sort((a, b) => (a.exit_time || 0) - (b.exit_time || 0));
    const wins = sorted.filter(p => (p.pnl || 0) > 0);
    const losses = sorted.filter(p => (p.pnl || 0) <= 0);

    const totalWins = wins.reduce((sum, p) => sum + (p.pnl || 0), 0);
    const totalLosses = Math.abs(losses.reduce((sum, p) => sum + (p.pnl || 0), 0));
    const totalPnL = sorted.reduce((sum, p) => sum + (p.pnl || 0), 0);

    // Find largest win/loss
    const pnls = sorted.map(p => p.pnl || 0);
    const largestWin = Math.max(...pnls, 0);
    const largestLoss = Math.min(...pnls, 0);

    // Calculate consecutive wins/losses
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const pos of sorted) {
      if ((pos.pnl || 0) > 0) {
        currentWins++;
        currentLosses = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
      } else {
        currentLosses++;
        currentWins = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
      }
    }

    // Current streak
    let streakCount = 0;
    let streakType: 'W' | 'L' = 'W';
    for (let i = sorted.length - 1; i >= 0; i--) {
      const isWin = (sorted[i].pnl || 0) > 0;
      if (i === sorted.length - 1) {
        streakType = isWin ? 'W' : 'L';
        streakCount = 1;
      } else {
        if ((isWin && streakType === 'W') || (!isWin && streakType === 'L')) {
          streakCount++;
        } else {
          break;
        }
      }
    }

    // Drawdown calculation
    let runningPnL = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const pos of sorted) {
      runningPnL += pos.pnl || 0;
      if (runningPnL > peak) peak = runningPnL;
      const drawdown = peak - runningPnL;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    const currentDrawdown = peak - runningPnL;

    // Average hold times (in minutes)
    const getHoldTime = (p: AggregatedPosition) => {
      if (!p.exit_time) return 0;
      return (p.exit_time - p.entry_time) / (1000 * 60); // minutes
    };

    const allHoldTimes = sorted.map(getHoldTime);
    const winHoldTimes = wins.map(getHoldTime);
    const lossHoldTimes = losses.map(getHoldTime);

    const avgHoldTime = allHoldTimes.length > 0 ? allHoldTimes.reduce((a, b) => a + b, 0) / allHoldTimes.length : 0;
    const avgWinHoldTime = winHoldTimes.length > 0 ? winHoldTimes.reduce((a, b) => a + b, 0) / winHoldTimes.length : 0;
    const avgLossHoldTime = lossHoldTimes.length > 0 ? lossHoldTimes.reduce((a, b) => a + b, 0) / lossHoldTimes.length : 0;

    return {
      totalPnL,
      winRate: (wins.length / sorted.length) * 100,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? Infinity : 0),
      expectancy: totalPnL / sorted.length,
      avgWin: wins.length > 0 ? totalWins / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLosses / losses.length : 0,
      largestWin,
      largestLoss: Math.abs(largestLoss),
      totalTrades: sorted.length,
      winCount: wins.length,
      lossCount: losses.length,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      currentStreak: { count: streakCount, type: streakType },
      currentDrawdown,
      maxDrawdown,
      avgHoldTime,
      avgWinHoldTime,
      avgLossHoldTime,
    };
  }, [closedPositions]);

  // Long vs Short comparison
  const sideStats = useMemo(() => {
    const longs = closedPositions.filter(p => p.position_type === 'LONG');
    const shorts = closedPositions.filter(p => p.position_type === 'SHORT');

    const calcStats = (positions: AggregatedPosition[]) => {
      const wins = positions.filter(p => (p.pnl || 0) > 0);
      const totalPnL = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);
      return {
        count: positions.length,
        pnl: totalPnL,
        wins: wins.length,
        winRate: positions.length > 0 ? (wins.length / positions.length) * 100 : 0,
        avgPnl: positions.length > 0 ? totalPnL / positions.length : 0,
      };
    };

    return {
      long: calcStats(longs),
      short: calcStats(shorts),
    };
  }, [closedPositions]);

  // Performance by category
  const categoryStats = useMemo(() => {
    const categoryMap = new Map<string, { pnl: number; count: number; wins: number }>();

    closedPositions.forEach(p => {
      const ann = annotations.get(p.position_id);
      const category = ann?.category || 'Uncategorized';

      if (!categoryMap.has(category)) {
        categoryMap.set(category, { pnl: 0, count: 0, wins: 0 });
      }
      const current = categoryMap.get(category)!;
      current.pnl += p.pnl || 0;
      current.count++;
      if ((p.pnl || 0) > 0) current.wins++;
    });

    return Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category: category.charAt(0).toUpperCase() + category.slice(1),
        ...data,
        winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
        avgPnl: data.count > 0 ? data.pnl / data.count : 0,
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [closedPositions, annotations]);

  // Formatting helpers
  const formatCurrency = (value: number, showSign = true) => {
    const prefix = showSign ? (value >= 0 ? '+' : '-') : (value < 0 ? '-' : '');
    return `${prefix}$${Math.round(Math.abs(value)).toLocaleString()}`;
  };

  const formatProfitFactor = (value: number) => {
    if (value === Infinity) return '∞';
    return value.toFixed(2);
  };

  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  // Get bar width for visualizations
  const getBarWidth = (value: number, max: number) => {
    if (max === 0) return 0;
    return Math.min((Math.abs(value) / max) * 100, 100);
  };

  if (loading) {
    return <div className="stats-tab"><div className="stats-loading">Loading statistics...</div></div>;
  }

  const maxCategoryPnL = Math.max(...categoryStats.map(c => Math.abs(c.pnl)), 1);

  return (
    <div className="stats-tab">
      {/* Core Metrics */}
      <section className="stats-section">
        <h2><BarChart3 size={20} /> Core Metrics</h2>
        <div className="core-metrics-grid">
          {/* Primary Stats */}
          <div className={`metric-card large ${coreStats.totalPnL >= 0 ? 'positive' : 'negative'}`}>
            <span className="metric-label">Total P&L</span>
            <span className="metric-value">{formatCurrency(coreStats.totalPnL)}</span>
            <span className="metric-detail">{coreStats.totalTrades} trades</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Win Rate</span>
            <span className="metric-value">{coreStats.winRate.toFixed(1)}%</span>
            <span className="metric-detail">{coreStats.winCount}W / {coreStats.lossCount}L</span>
          </div>

          <div className={`metric-card ${coreStats.profitFactor >= 1 ? 'positive' : 'negative'}`}>
            <span className="metric-label">Profit Factor</span>
            <span className="metric-value">{formatProfitFactor(coreStats.profitFactor)}</span>
          </div>

          <div className={`metric-card ${coreStats.expectancy >= 0 ? 'positive' : 'negative'}`}>
            <span className="metric-label">Expectancy</span>
            <span className="metric-value">{formatCurrency(coreStats.expectancy)}</span>
            <span className="metric-detail">per trade</span>
          </div>

          {/* Win/Loss Stats */}
          <div className="metric-card positive">
            <span className="metric-label">Avg Winner</span>
            <span className="metric-value">{formatCurrency(coreStats.avgWin, false)}</span>
          </div>

          <div className="metric-card negative">
            <span className="metric-label">Avg Loser</span>
            <span className="metric-value">{formatCurrency(-coreStats.avgLoss, false)}</span>
          </div>

          <div className="metric-card positive">
            <span className="metric-label">Largest Win</span>
            <span className="metric-value">{formatCurrency(coreStats.largestWin, false)}</span>
          </div>

          <div className="metric-card negative">
            <span className="metric-label">Largest Loss</span>
            <span className="metric-value">{formatCurrency(-coreStats.largestLoss, false)}</span>
          </div>

          {/* Streak Stats */}
          <div className="metric-card positive">
            <span className="metric-label">Max Consecutive Wins</span>
            <span className="metric-value">{coreStats.maxConsecutiveWins}</span>
          </div>

          <div className="metric-card negative">
            <span className="metric-label">Max Consecutive Losses</span>
            <span className="metric-value">{coreStats.maxConsecutiveLosses}</span>
          </div>

          <div className={`metric-card ${coreStats.currentStreak.type === 'W' ? 'positive' : 'negative'}`}>
            <span className="metric-label">Current Streak</span>
            <span className="metric-value">{coreStats.currentStreak.count}{coreStats.currentStreak.type}</span>
          </div>

          <div className={`metric-card ${coreStats.currentDrawdown > 0 ? 'negative' : ''}`}>
            <span className="metric-label">Drawdown</span>
            <span className="metric-value">-{formatCurrency(coreStats.currentDrawdown, false)}</span>
            <span className="metric-detail">max: -{formatCurrency(coreStats.maxDrawdown, false)}</span>
          </div>

          {/* Hold Time Stats */}
          <div className="metric-card">
            <span className="metric-label">Avg Hold Time</span>
            <span className="metric-value">{formatTime(coreStats.avgHoldTime)}</span>
          </div>

          <div className="metric-card positive">
            <span className="metric-label">Avg Winner Hold</span>
            <span className="metric-value">{formatTime(coreStats.avgWinHoldTime)}</span>
          </div>

          <div className="metric-card negative">
            <span className="metric-label">Avg Loser Hold</span>
            <span className="metric-value">{formatTime(coreStats.avgLossHoldTime)}</span>
          </div>
        </div>
      </section>

      {/* Long vs Short */}
      <section className="stats-section">
        <h2><ArrowUpRight size={20} /> Long vs Short</h2>
        <div className="side-comparison">
          <div className={`side-card ${sideStats.long.pnl >= 0 ? 'positive' : 'negative'}`}>
            <div className="side-header">
              <ArrowUpRight size={24} />
              <span>LONG</span>
            </div>
            <div className="side-stats">
              <div className="side-stat">
                <span className="side-stat-label">P&L</span>
                <span className="side-stat-value">{formatCurrency(sideStats.long.pnl)}</span>
              </div>
              <div className="side-stat">
                <span className="side-stat-label">Trades</span>
                <span className="side-stat-value">{sideStats.long.count}</span>
              </div>
              <div className="side-stat">
                <span className="side-stat-label">Win Rate</span>
                <span className="side-stat-value">{sideStats.long.winRate.toFixed(1)}%</span>
              </div>
              <div className="side-stat">
                <span className="side-stat-label">Avg P&L</span>
                <span className="side-stat-value">{formatCurrency(sideStats.long.avgPnl)}</span>
              </div>
            </div>
          </div>

          <div className={`side-card ${sideStats.short.pnl >= 0 ? 'positive' : 'negative'}`}>
            <div className="side-header">
              <ArrowDownRight size={24} />
              <span>SHORT</span>
            </div>
            <div className="side-stats">
              <div className="side-stat">
                <span className="side-stat-label">P&L</span>
                <span className="side-stat-value">{formatCurrency(sideStats.short.pnl)}</span>
              </div>
              <div className="side-stat">
                <span className="side-stat-label">Trades</span>
                <span className="side-stat-value">{sideStats.short.count}</span>
              </div>
              <div className="side-stat">
                <span className="side-stat-label">Win Rate</span>
                <span className="side-stat-value">{sideStats.short.winRate.toFixed(1)}%</span>
              </div>
              <div className="side-stat">
                <span className="side-stat-label">Avg P&L</span>
                <span className="side-stat-value">{formatCurrency(sideStats.short.avgPnl)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Performance by Category */}
      <section className="stats-section">
        <h2><Target size={20} /> Performance by Category</h2>
        <div className="breakdown-list">
          {categoryStats.map(c => (
            <div key={c.category} className="breakdown-row">
              <span className="breakdown-label">{c.category}</span>
              <div className="breakdown-bar-container">
                <div
                  className={`breakdown-bar ${c.pnl >= 0 ? 'positive' : 'negative'}`}
                  style={{ width: `${getBarWidth(c.pnl, maxCategoryPnL)}%` }}
                />
              </div>
              <span className={`breakdown-value ${c.pnl >= 0 ? 'positive' : 'negative'}`}>
                {formatCurrency(c.pnl)}
              </span>
              <span className="breakdown-detail">{c.count} ({c.winRate.toFixed(0)}%)</span>
            </div>
          ))}
        </div>
      </section>

      <style>{`
        .stats-tab {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .stats-loading {
          text-align: center;
          padding: 3rem;
          color: var(--text-muted);
        }

        .stats-section {
          background: white;
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          border: 1px solid #f1f5f9;
        }

        .stats-section h2 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 1.25rem 0;
        }

        .stats-section h2 svg {
          color: var(--accent);
        }

        /* Core Metrics Grid */
        .core-metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 1rem;
        }

        .metric-card {
          background: #f8fafc;
          border-radius: 12px;
          padding: 1rem;
          border: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .metric-card.large {
          grid-column: span 2;
          padding: 1.25rem;
        }

        .metric-card.positive {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.03) 100%);
          border-color: rgba(16, 185, 129, 0.2);
        }

        .metric-card.negative {
          background: linear-gradient(135deg, rgba(220, 38, 38, 0.08) 0%, rgba(220, 38, 38, 0.03) 100%);
          border-color: rgba(220, 38, 38, 0.2);
        }

        .metric-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: var(--text-muted);
          font-weight: 500;
        }

        .metric-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .metric-card.large .metric-value {
          font-size: 2rem;
        }

        .metric-card.positive .metric-value {
          color: var(--success);
        }

        .metric-card.negative .metric-value {
          color: var(--danger);
        }

        .metric-detail {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        /* Side Comparison */
        .side-comparison {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .side-card {
          background: #f8fafc;
          border-radius: 12px;
          padding: 1.25rem;
          border: 1px solid #e2e8f0;
        }

        .side-card.positive {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.03) 100%);
          border-color: rgba(16, 185, 129, 0.2);
        }

        .side-card.negative {
          background: linear-gradient(135deg, rgba(220, 38, 38, 0.08) 0%, rgba(220, 38, 38, 0.03) 100%);
          border-color: rgba(220, 38, 38, 0.2);
        }

        .side-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid #e2e8f0;
        }

        .side-card.positive .side-header svg {
          color: var(--success);
        }

        .side-card.negative .side-header svg {
          color: var(--danger);
        }

        .side-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .side-stat {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }

        .side-stat-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .side-stat-value {
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        /* Breakdown Lists */
        .breakdown-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .breakdown-row {
          display: grid;
          grid-template-columns: 100px 1fr 90px 80px;
          gap: 1rem;
          align-items: center;
          padding: 0.5rem 0.75rem;
          background: #f8fafc;
          border-radius: 8px;
        }

        .breakdown-label {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .breakdown-bar-container {
          height: 8px;
          background: #e2e8f0;
          border-radius: 4px;
          overflow: hidden;
        }

        .breakdown-bar {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .breakdown-bar.positive {
          background: linear-gradient(90deg, rgba(16, 185, 129, 0.5), var(--success));
        }

        .breakdown-bar.negative {
          background: linear-gradient(90deg, rgba(220, 38, 38, 0.5), var(--danger));
        }

        .breakdown-value {
          font-size: 0.875rem;
          font-weight: 700;
          text-align: right;
        }

        .breakdown-value.positive {
          color: var(--success);
        }

        .breakdown-value.negative {
          color: var(--danger);
        }

        .breakdown-detail {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-align: right;
        }

        @media (max-width: 768px) {
          .core-metrics-grid {
            grid-template-columns: 1fr 1fr;
          }

          .metric-card.large {
            grid-column: span 2;
          }

          .side-comparison {
            grid-template-columns: 1fr;
          }

          .breakdown-row {
            grid-template-columns: 80px 1fr 70px 60px;
            gap: 0.5rem;
          }
        }
      `}</style>
    </div>
  );
}
