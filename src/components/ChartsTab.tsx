import { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, TrendingUp, TrendingDown, Target, Timer, Calendar, PieChart, Activity, DollarSign } from 'lucide-react';
import { usePositions } from '../hooks/usePositions';

interface AggregatedPosition {
  position_id: string;
  market_symbol: string;
  entry_time: number;
  exit_time: number | null;
  entry_date: string;
  exit_date: string | null;
  pnl: number | null;
  position_type: 'LONG' | 'SHORT';
  is_closed: boolean;
  total_entry_value?: number;
}

const STARTING_CAPITAL = 10000;
const FEES_STORAGE_KEY = 'trading-journal-fees-expenses';

export function ChartsTab() {
  const { positions: rawPositions, loading } = usePositions();
  const positions = rawPositions as unknown as AggregatedPosition[];

  const [hoveredEquityPoint, setHoveredEquityPoint] = useState<number | null>(null);
  const [hoveredDrawdownPoint, setHoveredDrawdownPoint] = useState<number | null>(null);
  const [hoveredWinRatePoint, setHoveredWinRatePoint] = useState<number | null>(null);
  const [hoveredDurationPoint, setHoveredDurationPoint] = useState<number | null>(null);
  const [hoveredSizePoint, setHoveredSizePoint] = useState<number | null>(null);
  const [equityAnimated, setEquityAnimated] = useState(false);
  const [drawdownAnimated, setDrawdownAnimated] = useState(false);
  const [winRateAnimated, setWinRateAnimated] = useState(false);
  const [winsLossesAnimated, setWinsLossesAnimated] = useState(false);
  const [rMultipleAnimated, setRMultipleAnimated] = useState(false);
  const [monthlyAnimated, setMonthlyAnimated] = useState(false);
  const [marketAnimated, setMarketAnimated] = useState(false);
  const [dayAnimated, setDayAnimated] = useState(false);
  const equityPathRef = useRef<SVGPathElement>(null);

  // Read fees/costs from localStorage (same source as KPI sidebar)
  const [feesExpenses, setFeesExpenses] = useState<number>(() => {
    const stored = localStorage.getItem(FEES_STORAGE_KEY);
    return stored ? parseFloat(stored) : 0;
  });

  useEffect(() => {
    const handleFeesChange = () => {
      const stored = localStorage.getItem(FEES_STORAGE_KEY);
      setFeesExpenses(stored ? parseFloat(stored) : 0);
    };
    window.addEventListener('fees-expenses-changed', handleFeesChange);
    return () => window.removeEventListener('fees-expenses-changed', handleFeesChange);
  }, []);

  // Sort positions by exit time for chronological charts
  const sortedPositions = useMemo(() => {
    return positions
      .filter(p => p.is_closed && p.pnl !== null && p.exit_time)
      .sort((a, b) => (a.exit_time || 0) - (b.exit_time || 0));
  }, [positions]);

  // Equity curve data (portfolio value over time, with fees spread across trades)
  const equityData = useMemo(() => {
    let portfolioValue = STARTING_CAPITAL;
    const data: { date: Date; value: number; pnl: number; tradeNum: number }[] = [];
    const feePerTrade = sortedPositions.length > 0 ? feesExpenses / sortedPositions.length : 0;

    if (sortedPositions.length > 0) {
      const firstDate = new Date(sortedPositions[0].exit_time!);
      firstDate.setHours(0, 0, 0, 0);
      data.push({ date: firstDate, value: STARTING_CAPITAL, pnl: 0, tradeNum: 0 });
    }

    sortedPositions.forEach((p, i) => {
      const netPnl = (p.pnl || 0) - feePerTrade;
      portfolioValue += netPnl;
      data.push({
        date: new Date(p.exit_time!),
        value: portfolioValue,
        pnl: netPnl,
        tradeNum: i + 1
      });
    });

    return data;
  }, [sortedPositions, feesExpenses]);

  // All-time high points on the equity curve (filtered to significant ones only)
  const athPoints = useMemo(() => {
    if (equityData.length < 2) return [];
    const points: { index: number; value: number; date: Date }[] = [];
    let lastMarkedPeak = equityData[0].value;
    let lowestSinceMarked = equityData[0].value;
    const minDrawdownPct = 0.5; // require 0.5% pullback before marking next ATH

    for (let i = 1; i < equityData.length; i++) {
      if (equityData[i].value < lowestSinceMarked) {
        lowestSinceMarked = equityData[i].value;
      }
      if (equityData[i].value > lastMarkedPeak) {
        const drawdown = ((lastMarkedPeak - lowestSinceMarked) / lastMarkedPeak) * 100;
        if (drawdown >= minDrawdownPct || points.length === 0) {
          points.push({ index: i, value: equityData[i].value, date: equityData[i].date });
          lastMarkedPeak = equityData[i].value;
          lowestSinceMarked = equityData[i].value;
        } else {
          // Update peak but don't add marker
          lastMarkedPeak = equityData[i].value;
        }
      }
    }
    return points;
  }, [equityData]);

  // Set for quick ATH index lookup (used in tooltip)
  const athIndexSet = useMemo(() => new Set(athPoints.map(p => p.index)), [athPoints]);

  // Drawdown data (using same fee-adjusted PnL as equity curve for consistency)
  const drawdownData = useMemo(() => {
    let portfolioValue = STARTING_CAPITAL;
    let peak = STARTING_CAPITAL;
    const feePerTrade = sortedPositions.length > 0 ? feesExpenses / sortedPositions.length : 0;

    return sortedPositions.map((p, i) => {
      const netPnl = (p.pnl || 0) - feePerTrade;
      portfolioValue += netPnl;
      if (portfolioValue > peak) peak = portfolioValue;
      const drawdown = peak - portfolioValue;
      const drawdownPct = (drawdown / peak) * 100;

      return {
        date: new Date(p.exit_time!),
        drawdown,
        drawdownPct,
        portfolioValue,
        peak,
        tradeNum: i + 1
      };
    });
  }, [sortedPositions, feesExpenses]);

  // Rolling Win Rate (10-trade window)
  const rollingWinRate = useMemo(() => {
    const windowSize = 10;
    return sortedPositions.map((p, i) => {
      const windowStart = Math.max(0, i - windowSize + 1);
      const window = sortedPositions.slice(windowStart, i + 1);
      const wins = window.filter(pos => (pos.pnl || 0) > 0).length;
      const winRate = (wins / window.length) * 100;
      return {
        date: new Date(p.exit_time!),
        winRate,
        tradeNum: i + 1,
        windowSize: window.length
      };
    });
  }, [sortedPositions]);

  // Cumulative Wins vs Losses
  const cumulativeWinsLosses = useMemo(() => {
    let cumWins = 0;
    let cumLosses = 0;
    return sortedPositions.map((p, i) => {
      if ((p.pnl || 0) > 0) {
        cumWins += p.pnl || 0;
      } else {
        cumLosses += Math.abs(p.pnl || 0);
      }
      return {
        date: new Date(p.exit_time!),
        cumWins,
        cumLosses,
        tradeNum: i + 1,
        edge: cumWins - cumLosses
      };
    });
  }, [sortedPositions]);

  // Trade Size vs P&L scatter data
  const sizeData = useMemo(() => {
    return sortedPositions
      .filter(p => p.total_entry_value && p.total_entry_value > 0)
      .map(p => ({
        size: p.total_entry_value || 0,
        pnl: p.pnl || 0,
        symbol: p.market_symbol,
        isWin: (p.pnl || 0) > 0
      }));
  }, [sortedPositions]);

  // R-Multiple Distribution (using avg loss as R)
  const rMultipleData = useMemo(() => {
    const losses = sortedPositions.filter(p => (p.pnl || 0) < 0);
    const avgLoss = losses.length > 0
      ? Math.abs(losses.reduce((sum, p) => sum + (p.pnl || 0), 0) / losses.length)
      : 1;

    const rMultiples = sortedPositions.map(p => ({
      r: (p.pnl || 0) / avgLoss,
      pnl: p.pnl || 0,
      isWin: (p.pnl || 0) > 0
    }));

    // Create histogram buckets from -3R to +5R
    const buckets: { min: number; max: number; count: number; isPositive: boolean }[] = [];
    const bucketRanges = [
      { min: -Infinity, max: -2, label: '< -2R' },
      { min: -2, max: -1, label: '-2R to -1R' },
      { min: -1, max: 0, label: '-1R to 0' },
      { min: 0, max: 1, label: '0 to 1R' },
      { min: 1, max: 2, label: '1R to 2R' },
      { min: 2, max: 3, label: '2R to 3R' },
      { min: 3, max: Infinity, label: '> 3R' },
    ];

    bucketRanges.forEach(range => {
      const count = rMultiples.filter(r => r.r > range.min && r.r <= range.max).length;
      buckets.push({
        min: range.min === -Infinity ? -3 : range.min,
        max: range.max === Infinity ? 4 : range.max,
        count,
        isPositive: range.min >= 0
      });
    });

    return { buckets, avgLoss, rMultiples };
  }, [sortedPositions]);

  // Trade Duration vs P&L scatter data
  const durationData = useMemo(() => {
    return sortedPositions.map(p => {
      const duration = (p.exit_time! - p.entry_time) / (1000 * 60 * 60);
      return {
        duration,
        pnl: p.pnl || 0,
        symbol: p.market_symbol,
        isWin: (p.pnl || 0) > 0
      };
    });
  }, [sortedPositions]);

  // Monthly performance data
  const monthlyData = useMemo(() => {
    const monthlyPnL = new Map<string, { pnl: number; trades: number; wins: number }>();

    sortedPositions.forEach(p => {
      const date = new Date(p.exit_time!);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const existing = monthlyPnL.get(monthKey) || { pnl: 0, trades: 0, wins: 0 };
      existing.pnl += p.pnl || 0;
      existing.trades++;
      if ((p.pnl || 0) > 0) existing.wins++;
      monthlyPnL.set(monthKey, existing);
    });

    return Array.from(monthlyPnL.entries())
      .map(([key, data]) => ({
        month: key,
        label: new Date(key + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        ...data,
        winRate: (data.wins / data.trades) * 100
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [sortedPositions]);

  // P&L by Market
  const marketPnL = useMemo(() => {
    const byMarket = new Map<string, { pnl: number; trades: number; wins: number }>();

    sortedPositions.forEach(p => {
      const symbol = p.market_symbol.replace('_USDC', '');
      const existing = byMarket.get(symbol) || { pnl: 0, trades: 0, wins: 0 };
      existing.pnl += p.pnl || 0;
      existing.trades++;
      if ((p.pnl || 0) > 0) existing.wins++;
      byMarket.set(symbol, existing);
    });

    return Array.from(byMarket.entries())
      .map(([symbol, data]) => ({
        symbol,
        ...data,
        winRate: (data.wins / data.trades) * 100
      }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [sortedPositions]);

  // P&L by Day of Week
  const dayOfWeekPnL = useMemo(() => {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayMap = new Map<number, { pnl: number; trades: number; wins: number }>();

    for (let i = 0; i < 7; i++) {
      dayMap.set(i, { pnl: 0, trades: 0, wins: 0 });
    }

    sortedPositions.forEach(p => {
      const day = new Date(p.entry_time).getDay();
      const current = dayMap.get(day)!;
      current.pnl += p.pnl || 0;
      current.trades++;
      if ((p.pnl || 0) > 0) current.wins++;
    });

    return Array.from(dayMap.entries())
      .map(([day, data]) => ({
        day,
        label: dayNames[day],
        ...data,
        winRate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
      }))
      .filter(d => d.trades > 0)
      .sort((a, b) => a.day - b.day); // Sort by weekday order (Sunday=0 through Saturday=6)
  }, [sortedPositions]);

  // Chart dimensions
  const chartWidth = 100;
  const chartHeight = 40;

  const formatCurrency = (value: number, showSign = true) => {
    const prefix = showSign ? (value >= 0 ? '+' : '') : '';
    return `${prefix}$${Math.round(value).toLocaleString()}`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // SVG path generators
  const generateEquityPath = () => {
    if (equityData.length < 2) return '';
    const minValue = Math.min(...equityData.map(d => d.value));
    const maxValue = Math.max(...equityData.map(d => d.value));
    const valueRange = maxValue - minValue || 1;

    return equityData.map((d, i) => {
      const x = (i / (equityData.length - 1)) * chartWidth;
      const y = chartHeight - ((d.value - minValue) / valueRange) * chartHeight;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  };

  const generateEquityArea = () => {
    if (equityData.length < 2) return '';
    const minValue = Math.min(...equityData.map(d => d.value));
    const maxValue = Math.max(...equityData.map(d => d.value));
    const valueRange = maxValue - minValue || 1;

    const linePath = equityData.map((d, i) => {
      const x = (i / (equityData.length - 1)) * chartWidth;
      const y = chartHeight - ((d.value - minValue) / valueRange) * chartHeight;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    return `${linePath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`;
  };

  const generateDrawdownPath = () => {
    if (drawdownData.length < 2) return '';
    const maxDrawdown = Math.max(...drawdownData.map(d => d.drawdown), 1);

    return drawdownData.map((d, i) => {
      const x = (i / (drawdownData.length - 1)) * chartWidth;
      const y = (d.drawdown / maxDrawdown) * chartHeight;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  };

  const generateDrawdownArea = () => {
    if (drawdownData.length < 2) return '';
    const maxDrawdown = Math.max(...drawdownData.map(d => d.drawdown), 1);

    const linePath = drawdownData.map((d, i) => {
      const x = (i / (drawdownData.length - 1)) * chartWidth;
      const y = (d.drawdown / maxDrawdown) * chartHeight;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    return `M 0 0 ${linePath} L ${chartWidth} 0 Z`;
  };

  const getEquityHoverX = (index: number) => {
    if (equityData.length < 2) return 0;
    return (index / (equityData.length - 1)) * 100;
  };

  const getDrawdownHoverX = (index: number) => {
    if (drawdownData.length < 2) return 0;
    return (index / (drawdownData.length - 1)) * 100;
  };

  // Trigger chart animations after data loads with staggered delays
  useEffect(() => {
    if (!loading && equityData.length > 0) {
      const timers = [
        setTimeout(() => setEquityAnimated(true), 100),
        setTimeout(() => setDrawdownAnimated(true), 200),
        setTimeout(() => setWinRateAnimated(true), 300),
        setTimeout(() => setWinsLossesAnimated(true), 400),
        setTimeout(() => setRMultipleAnimated(true), 500),
        setTimeout(() => setMonthlyAnimated(true), 600),
        setTimeout(() => setMarketAnimated(true), 700),
        setTimeout(() => setDayAnimated(true), 800),
      ];
      return () => timers.forEach(t => clearTimeout(t));
    }
  }, [loading, equityData.length]);

  if (loading) {
    return <div className="charts-tab"><div className="charts-loading">Loading charts...</div></div>;
  }

  const equityMin = equityData.length > 0 ? Math.min(...equityData.map(d => d.value)) : STARTING_CAPITAL;
  const equityMax = equityData.length > 0 ? Math.max(...equityData.map(d => d.value)) : STARTING_CAPITAL;
  const maxDrawdown = drawdownData.length > 0 ? Math.max(...drawdownData.map(d => d.drawdown)) : 0;
  const maxMonthlyPnL = monthlyData.length > 0 ? Math.max(...monthlyData.map(m => Math.abs(m.pnl))) : 1;
  const maxDuration = durationData.length > 0 ? Math.max(...durationData.map(d => d.duration)) : 1;
  const maxPnLForScatter = durationData.length > 0 ? Math.max(...durationData.map(d => Math.abs(d.pnl))) : 1;
  const maxSize = sizeData.length > 0 ? Math.max(...sizeData.map(d => d.size)) : 1;
  const maxPnLForSize = sizeData.length > 0 ? Math.max(...sizeData.map(d => Math.abs(d.pnl))) : 1;
  const maxWinsLosses = cumulativeWinsLosses.length > 0
    ? Math.max(...cumulativeWinsLosses.map(d => Math.max(d.cumWins, d.cumLosses)))
    : 1;
  const maxRCount = rMultipleData.buckets.length > 0
    ? Math.max(...rMultipleData.buckets.map(b => b.count))
    : 1;

  return (
    <div className="charts-tab">
      {/* Equity Curve */}
      <section className="chart-section">
        <h2><LineChart size={20} /> Equity Curve</h2>
        <p className="chart-description">Portfolio value over time, starting from ${STARTING_CAPITAL.toLocaleString()}</p>

        <div className="chart-container">
          <div className="chart-y-labels">
            <span>{formatCurrency(equityMax, false)}</span>
            <span>{formatCurrency((equityMax + equityMin) / 2, false)}</span>
            <span>{formatCurrency(equityMin, false)}</span>
          </div>
          <div className="chart-main" onMouseLeave={() => setHoveredEquityPoint(null)}>
            <div className="chart-svg-wrapper">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                  </linearGradient>
                  <clipPath id="equityClip">
                    <rect
                      x="0"
                      y="0"
                      width={equityAnimated ? chartWidth : 0}
                      height={chartHeight}
                      style={{ transition: 'width 1.5s ease-out' }}
                    />
                  </clipPath>
                </defs>
                <g clipPath="url(#equityClip)">
                  <path d={generateEquityArea()} fill="url(#equityGradient)" />
                  <path
                    ref={equityPathRef}
                    d={generateEquityPath()}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="0.5"
                    vectorEffect="non-scaling-stroke"
                    style={{ strokeWidth: '2px' }}
                  />
                </g>
              </svg>
              <div className="chart-hover-areas">
                {equityData.map((_, i) => (
                  <div key={i} className="hover-area" style={{ left: `${getEquityHoverX(i)}%`, width: `${100 / equityData.length}%`, marginLeft: `${-50 / equityData.length}%` }} onMouseEnter={() => setHoveredEquityPoint(i)} />
                ))}
              </div>
              {/* ATH markers as HTML overlays — dot on the line, line extends upward */}
              {equityData.length >= 2 && athPoints.map(ath => {
                const xPct = (ath.index / (equityData.length - 1)) * 100;
                const minValue = equityMin;
                const maxValue = equityMax;
                const valueRange = maxValue - minValue || 1;
                const yPct = ((ath.value - minValue) / valueRange) * 100;
                return (
                  <div key={ath.index} className="ath-flag" style={{ left: `${xPct}%`, bottom: `calc(${yPct}% - 2px)` }}>
                    <div className="ath-flag-dot" />
                    <div className="ath-flag-line" />
                  </div>
                );
              })}
              {hoveredEquityPoint !== null && equityData[hoveredEquityPoint] && (
                <>
                  <div className="hover-line" style={{ left: `${getEquityHoverX(hoveredEquityPoint)}%` }} />
                  <div className="hover-tooltip" style={{ left: `${getEquityHoverX(hoveredEquityPoint)}%`, transform: getEquityHoverX(hoveredEquityPoint) > 80 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                    <div className="tooltip-date">{formatDate(equityData[hoveredEquityPoint].date)}</div>
                    <div className="tooltip-value positive">{formatCurrency(equityData[hoveredEquityPoint].value, false)}</div>
                    {hoveredEquityPoint > 0 && (
                      <div className={`tooltip-change ${equityData[hoveredEquityPoint].pnl >= 0 ? 'positive' : 'negative'}`}>
                        Trade #{equityData[hoveredEquityPoint].tradeNum}: {formatCurrency(equityData[hoveredEquityPoint].pnl)}
                      </div>
                    )}
                    {athIndexSet.has(hoveredEquityPoint) && (
                      <div className="tooltip-ath">New ATH</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Drawdown Chart */}
      <section className="chart-section">
        <h2><TrendingDown size={20} /> Drawdown</h2>
        <p className="chart-description">Peak to trough decline in portfolio value</p>

        <div className="chart-container">
          <div className="chart-y-labels drawdown">
            <span>$0</span>
            <span>-{formatCurrency(maxDrawdown / 2, false)}</span>
            <span>-{formatCurrency(maxDrawdown, false)}</span>
          </div>
          <div className="chart-main" onMouseLeave={() => setHoveredDrawdownPoint(null)}>
            <div className="chart-svg-wrapper">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dc2626" stopOpacity="0" />
                    <stop offset="100%" stopColor="#dc2626" stopOpacity="0.3" />
                  </linearGradient>
                  <clipPath id="drawdownClip">
                    <rect
                      x="0"
                      y="0"
                      width={drawdownAnimated ? chartWidth : 0}
                      height={chartHeight}
                      style={{ transition: 'width 1.5s ease-out' }}
                    />
                  </clipPath>
                </defs>
                <g clipPath="url(#drawdownClip)">
                  <path d={generateDrawdownArea()} fill="url(#drawdownGradient)" />
                  <path d={generateDrawdownPath()} fill="none" stroke="#dc2626" strokeWidth="0.5" vectorEffect="non-scaling-stroke" style={{ strokeWidth: '2px' }} />
                </g>
              </svg>
              <div className="chart-hover-areas">
                {drawdownData.map((_, i) => (
                  <div key={i} className="hover-area" style={{ left: `${getDrawdownHoverX(i)}%`, width: `${100 / drawdownData.length}%`, marginLeft: `${-50 / drawdownData.length}%` }} onMouseEnter={() => setHoveredDrawdownPoint(i)} />
                ))}
              </div>
              {hoveredDrawdownPoint !== null && drawdownData[hoveredDrawdownPoint] && (
                <>
                  <div className="hover-line negative" style={{ left: `${getDrawdownHoverX(hoveredDrawdownPoint)}%` }} />
                  <div className="hover-tooltip" style={{ left: `${getDrawdownHoverX(hoveredDrawdownPoint)}%`, transform: getDrawdownHoverX(hoveredDrawdownPoint) > 80 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                    <div className="tooltip-date">{formatDate(drawdownData[hoveredDrawdownPoint].date)}</div>
                    <div className="tooltip-value negative">-{formatCurrency(drawdownData[hoveredDrawdownPoint].drawdown, false)}</div>
                    <div className="tooltip-detail">{drawdownData[hoveredDrawdownPoint].drawdownPct.toFixed(1)}% from peak</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="chart-summary">
          <div className="summary-stat negative">
            <span className="summary-label">Max Drawdown</span>
            <span className="summary-value">-{formatCurrency(maxDrawdown, false)}</span>
          </div>
          <div className="summary-stat negative">
            <span className="summary-label">Max DD %</span>
            <span className="summary-value">-{drawdownData.length > 0 ? Math.max(...drawdownData.map(d => d.drawdownPct)).toFixed(1) : 0}%</span>
          </div>
        </div>
      </section>

      {/* Rolling Win Rate */}
      <section className="chart-section">
        <h2><Target size={20} /> Rolling Win Rate (10-trade)</h2>
        <p className="chart-description">Win rate calculated over a rolling window of 10 trades</p>

        <div className="chart-container">
          <div className="chart-y-labels">
            <span>100%</span>
            <span>50%</span>
            <span>0%</span>
          </div>
          <div className="chart-main" onMouseLeave={() => setHoveredWinRatePoint(null)}>
            <div className="chart-svg-wrapper">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                <defs>
                  <clipPath id="winRateClip">
                    <rect
                      x="0"
                      y="0"
                      width={winRateAnimated ? chartWidth : 0}
                      height={chartHeight}
                      style={{ transition: 'width 1.5s ease-out' }}
                    />
                  </clipPath>
                </defs>
                {/* 50% reference line */}
                <line x1="0" y1={chartHeight / 2} x2={chartWidth} y2={chartHeight / 2} stroke="#e2e8f0" strokeWidth="0.3" vectorEffect="non-scaling-stroke" strokeDasharray="2,2" />
                <g clipPath="url(#winRateClip)">
                  <path
                    d={rollingWinRate.map((d, i) => {
                      const x = (i / (rollingWinRate.length - 1)) * chartWidth;
                      const y = chartHeight - (d.winRate / 100) * chartHeight;
                      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#8b5cf6"
                    strokeWidth="0.5"
                    vectorEffect="non-scaling-stroke"
                    style={{ strokeWidth: '2px' }}
                  />
                </g>
              </svg>
              <div className="chart-hover-areas">
                {rollingWinRate.map((_, i) => (
                  <div key={i} className="hover-area" style={{ left: `${(i / (rollingWinRate.length - 1)) * 100}%`, width: `${100 / rollingWinRate.length}%`, marginLeft: `${-50 / rollingWinRate.length}%` }} onMouseEnter={() => setHoveredWinRatePoint(i)} />
                ))}
              </div>
              {hoveredWinRatePoint !== null && rollingWinRate[hoveredWinRatePoint] && (
                <>
                  <div className="hover-line" style={{ left: `${(hoveredWinRatePoint / (rollingWinRate.length - 1)) * 100}%`, background: '#8b5cf6' }} />
                  <div className="hover-tooltip" style={{ left: `${(hoveredWinRatePoint / (rollingWinRate.length - 1)) * 100}%`, transform: (hoveredWinRatePoint / (rollingWinRate.length - 1)) * 100 > 80 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                    <div className="tooltip-date">{formatDate(rollingWinRate[hoveredWinRatePoint].date)}</div>
                    <div className="tooltip-value" style={{ color: '#8b5cf6' }}>{rollingWinRate[hoveredWinRatePoint].winRate.toFixed(1)}%</div>
                    <div className="tooltip-detail">Trade #{rollingWinRate[hoveredWinRatePoint].tradeNum}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="chart-summary">
          <div className="summary-stat">
            <span className="summary-label">Current Win Rate</span>
            <span className="summary-value">{rollingWinRate.length > 0 ? rollingWinRate[rollingWinRate.length - 1].winRate.toFixed(1) : 0}%</span>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Peak Win Rate</span>
            <span className="summary-value">{rollingWinRate.length > 0 ? Math.max(...rollingWinRate.map(d => d.winRate)).toFixed(1) : 0}%</span>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Lowest Win Rate</span>
            <span className="summary-value">{rollingWinRate.length > 0 ? Math.min(...rollingWinRate.map(d => d.winRate)).toFixed(1) : 0}%</span>
          </div>
        </div>
      </section>

      {/* Cumulative Wins vs Losses */}
      <section className="chart-section">
        <h2><Activity size={20} /> Cumulative Wins vs Losses</h2>
        <p className="chart-description">Total winning dollars vs losing dollars over time - the gap is your edge</p>

        <div className="chart-container">
          <div className="chart-y-labels">
            <span>{formatCurrency(maxWinsLosses, false)}</span>
            <span>{formatCurrency(maxWinsLosses / 2, false)}</span>
            <span>$0</span>
          </div>
          <div className="chart-main">
            <div className="chart-svg-wrapper">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                <defs>
                  <clipPath id="winsLossesClip">
                    <rect
                      x="0"
                      y="0"
                      width={winsLossesAnimated ? chartWidth : 0}
                      height={chartHeight}
                      style={{ transition: 'width 1.5s ease-out' }}
                    />
                  </clipPath>
                </defs>
                <g clipPath="url(#winsLossesClip)">
                  {/* Wins line */}
                  <path
                    d={cumulativeWinsLosses.map((d, i) => {
                      const x = (i / (cumulativeWinsLosses.length - 1)) * chartWidth;
                      const y = chartHeight - (d.cumWins / maxWinsLosses) * chartHeight;
                      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="0.5"
                    vectorEffect="non-scaling-stroke"
                    style={{ strokeWidth: '2px' }}
                  />
                  {/* Losses line */}
                  <path
                    d={cumulativeWinsLosses.map((d, i) => {
                      const x = (i / (cumulativeWinsLosses.length - 1)) * chartWidth;
                      const y = chartHeight - (d.cumLosses / maxWinsLosses) * chartHeight;
                      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#dc2626"
                    strokeWidth="0.5"
                    vectorEffect="non-scaling-stroke"
                    style={{ strokeWidth: '2px' }}
                  />
                </g>
              </svg>
            </div>
          </div>
        </div>
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-dot wins"></span> Cumulative Wins</span>
          <span className="legend-item"><span className="legend-dot losses"></span> Cumulative Losses</span>
        </div>
        <div className="chart-summary">
          <div className="summary-stat positive">
            <span className="summary-label">Total Wins</span>
            <span className="summary-value">{cumulativeWinsLosses.length > 0 ? formatCurrency(cumulativeWinsLosses[cumulativeWinsLosses.length - 1].cumWins, false) : '$0'}</span>
          </div>
          <div className="summary-stat negative">
            <span className="summary-label">Total Losses</span>
            <span className="summary-value">{cumulativeWinsLosses.length > 0 ? formatCurrency(cumulativeWinsLosses[cumulativeWinsLosses.length - 1].cumLosses, false) : '$0'}</span>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Edge (Net)</span>
            <span className="summary-value" style={{ color: cumulativeWinsLosses.length > 0 && cumulativeWinsLosses[cumulativeWinsLosses.length - 1].edge >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {cumulativeWinsLosses.length > 0 ? formatCurrency(cumulativeWinsLosses[cumulativeWinsLosses.length - 1].edge) : '$0'}
            </span>
          </div>
        </div>
      </section>

      {/* Trade Size vs P&L Scatter */}
      {sizeData.length > 0 && (
        <section className="chart-section">
          <h2><DollarSign size={20} /> Trade Size vs P&L</h2>
          <p className="chart-description">Does position size correlate with better or worse outcomes?</p>

          <div className="scatter-container" onMouseLeave={() => setHoveredSizePoint(null)}>
            <div className="scatter-y-axis">
              <span>{formatCurrency(maxPnLForSize)}</span>
              <span>$0</span>
              <span>{formatCurrency(-maxPnLForSize)}</span>
            </div>
            <div className="scatter-plot">
              <div className="scatter-zero-line" />
              {sizeData.map((d, i) => {
                const x = (d.size / maxSize) * 100;
                const y = 50 - (d.pnl / maxPnLForSize) * 45;
                return (
                  <div key={i} className={`scatter-point ${d.isWin ? 'win' : 'loss'}`} style={{ left: `${x}%`, top: `${y}%` }} onMouseEnter={() => setHoveredSizePoint(i)}>
                    {hoveredSizePoint === i && (
                      <div className="scatter-tooltip">
                        <div className="tooltip-symbol">{d.symbol.replace('_USDC', '')}</div>
                        <div className={d.isWin ? 'positive' : 'negative'}>{formatCurrency(d.pnl)}</div>
                        <div className="tooltip-duration">Size: {formatCurrency(d.size, false)}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="scatter-x-axis">
              <span>$0</span>
              <span>{formatCurrency(maxSize / 2, false)}</span>
              <span>{formatCurrency(maxSize, false)}</span>
            </div>
          </div>
        </section>
      )}

      {/* R-Multiple Distribution */}
      <section className="chart-section">
        <h2><TrendingUp size={20} /> R-Multiple Distribution</h2>
        <p className="chart-description">Trade outcomes in terms of R (1R = avg loss of {formatCurrency(rMultipleData.avgLoss, false)})</p>

        <div className="r-multiple-chart">
          {rMultipleData.buckets.map((bucket, i) => (
            <div key={i} className="r-bar-wrapper">
              <div className="r-count">{bucket.count > 0 ? bucket.count : ''}</div>
              <div className="r-bar-container">
                <div
                  className={`r-bar ${bucket.isPositive ? 'positive' : 'negative'}`}
                  style={{
                    height: rMultipleAnimated ? `${(bucket.count / maxRCount) * 100}%` : '0%',
                    transition: `height 0.8s ease-out ${i * 0.1}s`
                  }}
                />
              </div>
              <div className="r-label">
                {bucket.min === -3 ? '< -2R' : bucket.max === 4 ? '> 3R' : `${bucket.min}R`}
              </div>
            </div>
          ))}
        </div>
        <div className="chart-summary">
          <div className="summary-stat">
            <span className="summary-label">Avg R</span>
            <span className="summary-value" style={{ color: rMultipleData.rMultiples.length > 0 && rMultipleData.rMultiples.reduce((sum, r) => sum + r.r, 0) / rMultipleData.rMultiples.length >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {rMultipleData.rMultiples.length > 0 ? (rMultipleData.rMultiples.reduce((sum, r) => sum + r.r, 0) / rMultipleData.rMultiples.length).toFixed(2) : '0'}R
            </span>
          </div>
          <div className="summary-stat positive">
            <span className="summary-label">Best Trade</span>
            <span className="summary-value">{rMultipleData.rMultiples.length > 0 ? Math.max(...rMultipleData.rMultiples.map(r => r.r)).toFixed(2) : '0'}R</span>
          </div>
          <div className="summary-stat negative">
            <span className="summary-label">Worst Trade</span>
            <span className="summary-value">{rMultipleData.rMultiples.length > 0 ? Math.min(...rMultipleData.rMultiples.map(r => r.r)).toFixed(2) : '0'}R</span>
          </div>
        </div>
      </section>

      {/* Trade Duration vs P&L Scatter */}
      <section className="chart-section">
        <h2><Timer size={20} /> Trade Duration vs P&L</h2>
        <p className="chart-description">How holding time relates to trade outcome</p>

        <div className="scatter-container" onMouseLeave={() => setHoveredDurationPoint(null)}>
          <div className="scatter-y-axis">
            <span>{formatCurrency(maxPnLForScatter)}</span>
            <span>$0</span>
            <span>{formatCurrency(-maxPnLForScatter)}</span>
          </div>
          <div className="scatter-plot">
            <div className="scatter-zero-line" />
            {durationData.map((d, i) => {
              const x = (d.duration / maxDuration) * 100;
              const y = 50 - (d.pnl / maxPnLForScatter) * 45;
              return (
                <div key={i} className={`scatter-point ${d.isWin ? 'win' : 'loss'}`} style={{ left: `${x}%`, top: `${y}%` }} onMouseEnter={() => setHoveredDurationPoint(i)}>
                  {hoveredDurationPoint === i && (
                    <div className="scatter-tooltip">
                      <div className="tooltip-symbol">{d.symbol.replace('_USDC', '')}</div>
                      <div className={d.isWin ? 'positive' : 'negative'}>{formatCurrency(d.pnl)}</div>
                      <div className="tooltip-duration">{d.duration.toFixed(1)}h</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="scatter-x-axis">
            <span>0h</span>
            <span>{(maxDuration / 2).toFixed(0)}h</span>
            <span>{maxDuration.toFixed(0)}h</span>
          </div>
        </div>
        <div className="chart-summary">
          <div className="summary-stat">
            <span className="summary-label">Avg Win Duration</span>
            <span className="summary-value">{(durationData.filter(d => d.isWin).reduce((sum, d) => sum + d.duration, 0) / Math.max(durationData.filter(d => d.isWin).length, 1)).toFixed(1)}h</span>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Avg Loss Duration</span>
            <span className="summary-value">{(durationData.filter(d => !d.isWin).reduce((sum, d) => sum + d.duration, 0) / Math.max(durationData.filter(d => !d.isWin).length, 1)).toFixed(1)}h</span>
          </div>
        </div>
      </section>

      {/* Monthly Performance */}
      <section className="chart-section">
        <h2><Calendar size={20} /> Monthly Performance</h2>
        <p className="chart-description">P&L aggregated by month</p>

        <div className="monthly-chart">
          {monthlyData.map((m, i) => (
            <div key={i} className="monthly-bar-wrapper">
              <div className="monthly-value" style={{ color: m.pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(m.pnl)}</div>
              <div className="monthly-bar-container">
                <div
                  className={`monthly-bar ${m.pnl >= 0 ? 'positive' : 'negative'}`}
                  style={{
                    height: monthlyAnimated ? `${(Math.abs(m.pnl) / maxMonthlyPnL) * 100}%` : '0%',
                    transition: `height 0.8s ease-out ${i * 0.15}s`
                  }}
                />
              </div>
              <div className="monthly-label">{m.label}</div>
              <div className="monthly-meta">{m.trades} trades</div>
            </div>
          ))}
        </div>
        <div className="chart-summary">
          <div className="summary-stat positive">
            <span className="summary-label">Best Month</span>
            <span className="summary-value">{monthlyData.length > 0 ? formatCurrency(Math.max(...monthlyData.map(m => m.pnl))) : '$0'}</span>
          </div>
          <div className="summary-stat negative">
            <span className="summary-label">Worst Month</span>
            <span className="summary-value">{monthlyData.length > 0 ? formatCurrency(Math.min(...monthlyData.map(m => m.pnl))) : '$0'}</span>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Avg Month</span>
            <span className="summary-value">{monthlyData.length > 0 ? formatCurrency(monthlyData.reduce((sum, m) => sum + m.pnl, 0) / monthlyData.length) : '$0'}</span>
          </div>
        </div>
      </section>

      {/* P&L by Market */}
      <section className="chart-section">
        <h2><PieChart size={20} /> P&L by Market</h2>
        <p className="chart-description">Performance breakdown by trading pair</p>

        <div className="market-breakdown">
          {marketPnL.map((m, i) => (
            <div key={i} className="market-row">
              <div className="market-info">
                <span className="market-symbol">{m.symbol}</span>
                <span className="market-trades">{m.trades} trades • {m.winRate.toFixed(0)}% WR</span>
              </div>
              <div className="market-bar-container">
                <div
                  className={`market-bar ${m.pnl >= 0 ? 'positive' : 'negative'}`}
                  style={{
                    width: marketAnimated ? `${(Math.abs(m.pnl) / Math.max(...marketPnL.map(x => Math.abs(x.pnl)))) * 100}%` : '0%',
                    transition: `width 0.8s ease-out ${i * 0.1}s`
                  }}
                />
              </div>
              <span className={`market-pnl ${m.pnl >= 0 ? 'positive' : 'negative'}`}>{formatCurrency(m.pnl)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* P&L by Day of Week */}
      <section className="chart-section">
        <h2><Calendar size={20} /> P&L by Day</h2>
        <p className="chart-description">Performance breakdown by day of week</p>

        <div className="market-breakdown">
          {dayOfWeekPnL.map((d, i) => (
            <div key={i} className="market-row">
              <div className="market-info">
                <span className="market-symbol">{d.label}</span>
                <span className="market-trades">{d.trades} trades • {d.winRate.toFixed(0)}% WR</span>
              </div>
              <div className="market-bar-container">
                <div
                  className={`market-bar ${d.pnl >= 0 ? 'positive' : 'negative'}`}
                  style={{
                    width: dayAnimated ? `${(Math.abs(d.pnl) / Math.max(...dayOfWeekPnL.map(x => Math.abs(x.pnl)))) * 100}%` : '0%',
                    transition: `width 0.8s ease-out ${i * 0.1}s`
                  }}
                />
              </div>
              <span className={`market-pnl ${d.pnl >= 0 ? 'positive' : 'negative'}`}>{formatCurrency(d.pnl)}</span>
            </div>
          ))}
        </div>
      </section>

      <style>{`
        .charts-tab {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .charts-loading {
          text-align: center;
          padding: 3rem;
          color: var(--text-muted);
        }

        .chart-section {
          background: white;
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          border: 1px solid #f1f5f9;
        }

        .chart-section h2 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 0.25rem 0;
        }

        .chart-section h2 svg {
          color: var(--accent);
        }

        .chart-description {
          font-size: 0.8rem;
          color: var(--text-muted);
          margin: 0 0 1rem 0;
        }

        .chart-container {
          display: flex;
          gap: 0.5rem;
        }

        .chart-y-labels {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          font-size: 0.7rem;
          color: var(--text-muted);
          text-align: right;
          min-width: 60px;
          height: 200px;
          padding-right: 0.5rem;
        }

        .chart-y-labels.drawdown {
          color: var(--danger);
        }

        .chart-main {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .chart-svg-wrapper {
          position: relative;
          height: 200px;
        }

        .chart-svg-wrapper svg {
          width: 100%;
          height: 100%;
        }

        .chart-hover-areas {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
        }

        .hover-area {
          position: absolute;
          height: 100%;
          cursor: crosshair;
        }

        .hover-line {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          background: var(--success);
          pointer-events: none;
          z-index: 10;
        }

        .hover-line.negative {
          background: var(--danger);
        }

        .hover-tooltip {
          position: absolute;
          top: 10px;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 0.5rem 0.75rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          z-index: 20;
          pointer-events: none;
          white-space: nowrap;
        }

        .tooltip-date {
          font-size: 0.75rem;
          color: var(--text-primary);
          font-weight: 600;
          margin-bottom: 0.25rem;
        }

        .tooltip-value {
          font-size: 1rem;
          font-weight: 700;
        }

        .tooltip-value.positive { color: var(--success); }
        .tooltip-value.negative { color: var(--danger); }

        .tooltip-change {
          font-size: 0.7rem;
          margin-top: 0.25rem;
        }

        .tooltip-change.positive { color: var(--success); }
        .tooltip-change.negative { color: var(--danger); }

        .tooltip-ath {
          font-size: 0.6rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--success);
          margin-top: 0.3rem;
          display: flex;
          align-items: center;
          gap: 0.3rem;
        }

        .tooltip-ath::before {
          content: '';
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--success);
          flex-shrink: 0;
        }

        .ath-flag {
          position: absolute;
          transform: translate(-50%, 0);
          pointer-events: none;
          z-index: 1;
          display: flex;
          flex-direction: column-reverse;
          align-items: center;
        }

        .ath-flag-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #6b7280;
          box-shadow: 0 0 5px rgba(107, 114, 128, 0.4);
        }

        .ath-flag-line {
          width: 1px;
          height: 18px;
          background: linear-gradient(to top, rgba(107, 114, 128, 0.45), rgba(107, 114, 128, 0));
        }

        .tooltip-detail {
          font-size: 0.7rem;
          color: var(--text-muted);
          margin-top: 0.125rem;
        }

        .chart-legend {
          display: flex;
          gap: 1.5rem;
          justify-content: center;
          margin-top: 0.75rem;
          font-size: 0.75rem;
          color: var(--text-secondary);
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .legend-dot {
          width: 10px;
          height: 3px;
          border-radius: 2px;
        }

        .legend-dot.wins {
          background: var(--success);
        }

        .legend-dot.losses {
          background: var(--danger);
        }

        .chart-summary {
          display: flex;
          gap: 2rem;
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid #e2e8f0;
        }

        .summary-stat {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }

        .summary-label {
          font-size: 0.7rem;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .summary-value {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .summary-stat.positive .summary-value { color: var(--success); }
        .summary-stat.negative .summary-value { color: var(--danger); }

        /* Scatter Plot */
        .scatter-container {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .scatter-y-axis {
          display: flex;
          justify-content: space-between;
          flex-direction: column;
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 50px;
          font-size: 0.65rem;
          color: var(--text-muted);
          text-align: right;
          padding-right: 0.5rem;
        }

        .scatter-plot {
          position: relative;
          height: 200px;
          margin-left: 55px;
          background: #fafafa;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
        }

        .scatter-zero-line {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 1px;
          background: #e2e8f0;
        }

        .scatter-point {
          position: absolute;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          cursor: pointer;
          transition: transform 0.2s;
        }

        .scatter-point.win {
          background: var(--success);
          box-shadow: 0 0 4px rgba(16, 185, 129, 0.5);
        }

        .scatter-point.loss {
          background: var(--danger);
          box-shadow: 0 0 4px rgba(220, 38, 38, 0.5);
        }

        .scatter-point:hover {
          transform: translate(-50%, -50%) scale(1.5);
          z-index: 10;
        }

        .scatter-tooltip {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 0.5rem 0.75rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          white-space: nowrap;
          z-index: 20;
          font-size: 0.75rem;
          margin-bottom: 8px;
        }

        .tooltip-symbol {
          font-weight: 700;
          color: var(--text-primary);
        }

        .tooltip-duration {
          color: var(--text-muted);
          font-size: 0.65rem;
        }

        .scatter-x-axis {
          display: flex;
          justify-content: space-between;
          margin-left: 55px;
          font-size: 0.65rem;
          color: var(--text-muted);
          margin-top: 0.25rem;
        }

        /* R-Multiple Chart */
        .r-multiple-chart {
          display: flex;
          gap: 8px;
          align-items: flex-end;
          height: 160px;
          padding: 1rem 0;
        }

        .r-bar-wrapper {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
        }

        .r-count {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 4px;
          min-height: 18px;
        }

        .r-bar-container {
          flex: 1;
          width: 100%;
          display: flex;
          align-items: flex-end;
        }

        .r-bar {
          width: 100%;
          border-radius: 4px 4px 0 0;
          min-height: 4px;
        }

        .r-bar.positive {
          background: linear-gradient(to top, rgba(16, 185, 129, 0.4), var(--success));
        }

        .r-bar.negative {
          background: linear-gradient(to top, rgba(220, 38, 38, 0.4), var(--danger));
        }

        .r-label {
          font-size: 0.7rem;
          font-weight: 500;
          color: var(--text-muted);
          margin-top: 8px;
        }

        /* Monthly Chart */
        .monthly-chart {
          display: flex;
          gap: 8px;
          align-items: flex-end;
          height: 180px;
          padding: 1rem 0;
        }

        .monthly-bar-wrapper {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
        }

        .monthly-value {
          font-size: 0.7rem;
          font-weight: 700;
          margin-bottom: 4px;
          min-height: 16px;
        }

        .monthly-bar-container {
          flex: 1;
          width: 100%;
          display: flex;
          align-items: flex-end;
        }

        .monthly-bar {
          width: 100%;
          border-radius: 4px 4px 0 0;
          min-height: 4px;
        }

        .monthly-bar.positive {
          background: linear-gradient(to top, rgba(16, 185, 129, 0.4), var(--success));
        }

        .monthly-bar.negative {
          background: linear-gradient(to top, rgba(220, 38, 38, 0.4), var(--danger));
        }

        .monthly-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-top: 8px;
        }

        .monthly-meta {
          font-size: 0.6rem;
          color: var(--text-muted);
        }

        /* Market Breakdown */
        .market-breakdown {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .market-row {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .market-info {
          width: 120px;
          flex-shrink: 0;
        }

        .market-symbol {
          font-weight: 700;
          color: var(--text-primary);
          display: block;
        }

        .market-trades {
          font-size: 0.7rem;
          color: var(--text-muted);
        }

        .market-bar-container {
          flex: 1;
          height: 24px;
          background: #f1f5f9;
          border-radius: 4px;
          overflow: hidden;
        }

        .market-bar {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .market-bar.positive {
          background: linear-gradient(to right, rgba(16, 185, 129, 0.4), var(--success));
        }

        .market-bar.negative {
          background: linear-gradient(to right, rgba(220, 38, 38, 0.4), var(--danger));
        }

        .market-pnl {
          width: 80px;
          text-align: right;
          font-weight: 700;
          font-size: 0.9rem;
        }

        .market-pnl.positive { color: var(--success); }
        .market-pnl.negative { color: var(--danger); }

        .positive { color: var(--success); }
        .negative { color: var(--danger); }

        @media (max-width: 768px) {
          .chart-y-labels {
            min-width: 50px;
            font-size: 0.6rem;
          }

          .chart-svg-wrapper {
            height: 150px;
          }

          .chart-y-labels {
            height: 150px;
          }

          .chart-summary {
            flex-wrap: wrap;
            gap: 1rem;
          }

          .scatter-plot {
            height: 150px;
          }

          .monthly-chart {
            height: 140px;
          }

          .market-info {
            width: 80px;
          }

          .r-multiple-chart {
            height: 120px;
          }
        }
      `}</style>
    </div>
  );
}
