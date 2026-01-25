import { useState, useEffect, useMemo } from 'react';
import { Target, TrendingUp, Calendar, Zap } from 'lucide-react';

interface Position {
  entry_time: number;
  entry_date: string;
  pnl: number | null;
  is_closed: boolean;
}

interface Milestone {
  target: number;
  label: string;
  daysToReach: number;
  targetDate: Date;
  multiplier: string;
}

const STARTING_CAPITAL = 10000;

const MILESTONES = [
  { target: 20000, label: '$20,000' },
  { target: 50000, label: '$50,000' },
  { target: 100000, label: '$100,000' },
  { target: 250000, label: '$250,000' },
  { target: 500000, label: '$500,000' },
  { target: 1000000, label: '$1,000,000' },
  { target: 2500000, label: '$2,500,000' },
  { target: 5000000, label: '$5,000,000' },
  { target: 10000000, label: '$10,000,000' },
  { target: 25000000, label: '$25,000,000' },
  { target: 50000000, label: '$50,000,000' },
  { target: 100000000, label: '$100,000,000' },
];

export function GrowthProjection() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  useEffect(() => {
    const loadPositions = async () => {
      try {
        const response = await fetch('/aggregated-positions.json');
        const data = await response.json();
        setPositions(data.positions);
      } catch (error) {
        console.error('Failed to load positions:', error);
      }
    };
    loadPositions();
  }, []);

  const { avgDailyReturnPct, currentPortfolio, tradingDays, totalDays } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDate = new Date(2025, 11, 19); // Dec 19, 2025

    // Build a map of PnL by date
    const pnlByDate = new Map<string, number>();
    positions.forEach(position => {
      if (!position.is_closed || position.pnl === null) return;
      const datePart = position.entry_date.split(' ')[0];
      const current = pnlByDate.get(datePart) || 0;
      pnlByDate.set(datePart, current + position.pnl);
    });

    // Generate all days from start date to today
    const dayCount = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const days: { dateKey: string; pnl: number; hasData: boolean }[] = [];

    for (let i = dayCount - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      const dateKey = `${day}/${month}/${year}`;
      const pnl = pnlByDate.get(dateKey) || 0;
      days.push({ dateKey, pnl, hasData: pnlByDate.has(dateKey) });
    }

    // Calculate compounding daily returns
    let portfolioValue = STARTING_CAPITAL;
    let totalDailyReturnPct = 0;
    let tradingDaysCount = 0;

    days.forEach(day => {
      if (day.hasData) {
        const dailyReturnPct = (day.pnl / portfolioValue) * 100;
        totalDailyReturnPct += dailyReturnPct;
        tradingDaysCount++;
        portfolioValue += day.pnl;
      }
    });

    const avgPct = tradingDaysCount > 0 ? totalDailyReturnPct / tradingDaysCount : 0;

    return {
      avgDailyReturnPct: avgPct,
      currentPortfolio: portfolioValue,
      tradingDays: tradingDaysCount,
      totalDays: dayCount
    };
  }, [positions]);

  const milestones = useMemo((): Milestone[] => {
    if (avgDailyReturnPct <= 0) return [];

    const dailyMultiplier = 1 + (avgDailyReturnPct / 100);
    const startDate = new Date(2025, 11, 19); // Dec 19, 2025 - same as chart

    return MILESTONES
      .filter(m => m.target > currentPortfolio)
      .map(m => {
        // Calculate days needed from START: target = STARTING_CAPITAL * (1 + rate)^days
        // days = ln(target/STARTING_CAPITAL) / ln(1 + rate)
        const daysFromStart = Math.ceil(
          Math.log(m.target / STARTING_CAPITAL) / Math.log(dailyMultiplier)
        );

        const targetDate = new Date(startDate);
        targetDate.setDate(startDate.getDate() + daysFromStart);

        const multiplier = (m.target / STARTING_CAPITAL).toFixed(0) + 'x';

        return {
          ...m,
          daysToReach: daysFromStart,
          targetDate,
          multiplier
        };
      });
  }, [avgDailyReturnPct, currentPortfolio]);

  // Generate chart data points at month-end intervals from start (Dec 19, 2025) to Dec 31, 2027
  const chartData = useMemo(() => {
    if (avgDailyReturnPct <= 0) return [];

    const dailyMultiplier = 1 + (avgDailyReturnPct / 100);
    const points: { day: number; value: number; date: Date; isMonthEnd: boolean; label: string; isPast: boolean }[] = [];
    const today = new Date();
    const startDate = new Date(2025, 11, 19); // Dec 19, 2025
    const endDate = new Date(2027, 11, 31); // Dec 31, 2027

    // Start with the beginning (Dec 19, 2025 = $10k)
    points.push({
      day: 0,
      value: STARTING_CAPITAL,
      date: new Date(startDate),
      isMonthEnd: false,
      label: 'Start',
      isPast: true
    });

    // Generate month-end points from Dec 2025 until Dec 31, 2027
    let currentDate = new Date(2025, 11, 31); // End of Dec 2025

    while (currentDate <= endDate) {
      const daysFromStart = Math.floor((currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const value = STARTING_CAPITAL * Math.pow(dailyMultiplier, daysFromStart);
      const isPast = currentDate <= today;

      const monthLabel = currentDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

      points.push({
        day: daysFromStart,
        value,
        date: new Date(currentDate),
        isMonthEnd: true,
        label: monthLabel,
        isPast
      });

      // Move to next month's end
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0);
    }

    return points;
  }, [avgDailyReturnPct]);

  // Find the index where past ends and future begins
  const todayIndex = useMemo(() => {
    for (let i = 0; i < chartData.length; i++) {
      if (!chartData[i].isPast) return i;
    }
    return chartData.length;
  }, [chartData]);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toFixed(0)}`;
  };

  const formatFullCurrency = (value: number) => {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  // SVG chart dimensions
  const chartWidth = 100;
  const chartHeight = 50;
  const paddingY = 2; // Small vertical padding to prevent clipping

  const maxValue = chartData.length > 0 ? chartData[chartData.length - 1].value : currentPortfolio;
  const minValue = STARTING_CAPITAL;

  const getX = (index: number) => {
    // No horizontal padding - line goes edge to edge
    return (index / (chartData.length - 1)) * chartWidth;
  };

  const getY = (value: number) => {
    // Linear scale with small vertical padding
    const normalized = (value - minValue) / (maxValue - minValue);
    return chartHeight - paddingY - normalized * (chartHeight - paddingY * 2);
  };

  // Get X position as percentage for hover areas
  const getXPercent = (index: number) => {
    return (index / (chartData.length - 1)) * 100;
  };

  // Past line path (from start to today)
  const pastLinePath = chartData
    .slice(0, todayIndex + 1)
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.value)}`)
    .join(' ');

  // Future line path (from today onwards)
  const futureLinePath = chartData
    .slice(todayIndex)
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(todayIndex + i)} ${getY(d.value)}`)
    .join(' ');

  // Full area path for the gradient fill
  const areaPath = chartData
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.value)}`)
    .join(' ') + ` L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`;

  // KPI calculations
  const doublingDays = avgDailyReturnPct > 0
    ? Math.ceil(Math.log(2) / Math.log(1 + avgDailyReturnPct / 100))
    : 0;

  const tenXDays = avgDailyReturnPct > 0
    ? Math.ceil(Math.log(10) / Math.log(1 + avgDailyReturnPct / 100))
    : 0;

  const hundredXDays = avgDailyReturnPct > 0
    ? Math.ceil(Math.log(100) / Math.log(1 + avgDailyReturnPct / 100))
    : 0;

  const thousandXDays = avgDailyReturnPct > 0
    ? Math.ceil(Math.log(1000) / Math.log(1 + avgDailyReturnPct / 100))
    : 0;

  if (positions.length === 0) {
    return (
      <div className="growth-projection">
        <div className="projection-loading">Loading projection data...</div>
      </div>
    );
  }

  return (
    <div className="growth-projection">
      <div className="projection-header">
        <div className="projection-title">
          <Target size={24} />
          <h2>Growth Projection</h2>
        </div>
        <p className="projection-subtitle">
          Based on {avgDailyReturnPct.toFixed(2)}% avg daily return over {tradingDays} trading days ({totalDays} calendar days)
        </p>
      </div>

      {/* KPI Cards */}
      <div className="projection-kpis">
        <div className="projection-kpi">
          <div className="kpi-icon">
            <TrendingUp size={18} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Avg Daily</span>
            <span className="kpi-value positive">{avgDailyReturnPct.toFixed(2)}%</span>
          </div>
        </div>
        <div className="projection-kpi">
          <div className="kpi-icon">
            <Calendar size={18} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Days</span>
            <span className="kpi-value">{totalDays}</span>
          </div>
        </div>
        <div className="projection-kpi">
          <div className="kpi-icon">
            <Zap size={18} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">2x Rate</span>
            <span className="kpi-value">{doublingDays}d</span>
          </div>
        </div>
        <div className="projection-kpi">
          <div className="kpi-icon">
            <Target size={18} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">10x Rate</span>
            <span className="kpi-value">{tenXDays}d</span>
          </div>
        </div>
        <div className="projection-kpi">
          <div className="kpi-icon">
            <Target size={18} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">100x Rate</span>
            <span className="kpi-value">{hundredXDays}d</span>
          </div>
        </div>
        <div className="projection-kpi">
          <div className="kpi-icon">
            <Target size={18} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">1000x Rate</span>
            <span className="kpi-value">{thousandXDays}d</span>
          </div>
        </div>
      </div>

      {/* Growth Chart */}
      <div className="projection-chart-container">
        <h3>Projected Growth Curve (Dec 2025 - Dec 2027)</h3>
        <div className="projection-chart">
          <div className="chart-y-labels">
            <span>{formatCurrency(maxValue)}</span>
            <span>{formatCurrency((maxValue + minValue) / 2)}</span>
            <span>{formatCurrency(minValue)}</span>
          </div>
          <div className="chart-main" onMouseLeave={() => setHoveredPoint(null)}>
            <div className="chart-svg-wrapper">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
                <defs>
                  <linearGradient id="projectionGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={areaPath} fill="url(#projectionGradient)" />
                {/* Past line (actual performance) - blue/accent color */}
                <path
                  d={pastLinePath}
                  fill="none"
                  stroke="#5b8def"
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                  style={{ strokeWidth: '2.5px' }}
                />
                {/* Future line (projection) - green color */}
                <path
                  d={futureLinePath}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                  style={{ strokeWidth: '2px' }}
                />
              </svg>
              {/* Hover areas for each data point */}
              <div className="chart-hover-areas">
                {chartData.map((_, i) => (
                  <div
                    key={i}
                    className="hover-area"
                    style={{
                      left: `${getXPercent(i)}%`,
                      width: `${100 / chartData.length}%`,
                      marginLeft: `${-50 / chartData.length}%`
                    }}
                    onMouseEnter={() => setHoveredPoint(i)}
                  />
                ))}
              </div>
              {/* Hover indicator line and tooltip */}
              {hoveredPoint !== null && chartData[hoveredPoint] && (
                <>
                  <div
                    className={`hover-line ${chartData[hoveredPoint].isPast ? 'past' : 'future'}`}
                    style={{ left: `${getXPercent(hoveredPoint)}%` }}
                  />
                  <div
                    className={`hover-tooltip ${chartData[hoveredPoint].isPast ? 'past' : 'future'}`}
                    style={{
                      left: `${getXPercent(hoveredPoint)}%`,
                      transform: getXPercent(hoveredPoint) > 80 ? 'translateX(-100%)' : 'translateX(-50%)'
                    }}
                  >
                    <div className="tooltip-label">{chartData[hoveredPoint].isPast ? 'Actual' : 'Projected'}</div>
                    <div className="tooltip-date">{chartData[hoveredPoint].label}</div>
                    <div className={`tooltip-value ${chartData[hoveredPoint].isPast ? 'past' : ''}`}>
                      {formatFullCurrency(chartData[hoveredPoint].value)}
                    </div>
                    <div className="tooltip-mult">
                      {(chartData[hoveredPoint].value / STARTING_CAPITAL).toFixed(1)}x from start
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="chart-x-labels">
              {chartData
                .filter((d) => d.isMonthEnd && (d.date.getMonth() === 0 || d.date.getMonth() === 6))
                .map((d, i) => (
                  <div key={i} className="x-label" style={{ left: `${(d.day / chartData[chartData.length - 1].day) * 100}%` }}>
                    <span className="x-label-text">{d.label}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Milestones Table */}
      <div className="milestones-container">
        <h3>Portfolio Milestones</h3>
        <div className="milestones-table">
          <div className="milestones-header">
            <span>Target</span>
            <span>Multiplier</span>
            <span>Days</span>
            <span>Target Date</span>
          </div>
          {milestones.map((milestone, i) => (
            <div key={i} className={`milestone-row ${i === 0 ? 'next-milestone' : ''}`}>
              <span className="milestone-target">{milestone.label}</span>
              <span className="milestone-multiplier">{milestone.multiplier}</span>
              <span className="milestone-days">{milestone.daysToReach}</span>
              <span className="milestone-date">{formatDate(milestone.targetDate)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="projection-disclaimer">
        * Projections assume consistent {avgDailyReturnPct.toFixed(2)}% daily returns compounding from current portfolio of {formatFullCurrency(currentPortfolio)}.
        Past performance does not guarantee future results.
      </div>

      <style>{`
        .growth-projection {
          background: white;
          border-radius: 16px;
          padding: 2rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          border: 1px solid #f1f5f9;
        }

        .projection-header {
          margin-bottom: 1.5rem;
        }

        .projection-title {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .projection-title h2 {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        .projection-title svg {
          color: var(--accent);
        }

        .projection-subtitle {
          color: var(--text-muted);
          font-size: 0.875rem;
          margin: 0;
        }

        .projection-loading {
          padding: 3rem;
          text-align: center;
          color: var(--text-muted);
        }

        /* KPI Cards */
        .projection-kpis {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 0.75rem;
          margin-bottom: 2rem;
        }

        .projection-kpi {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem;
          background: #f8fafc;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
        }

        .projection-kpi .kpi-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          border-radius: 8px;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%);
          color: var(--success);
        }

        .projection-kpi .kpi-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .projection-kpi .kpi-label {
          font-size: 0.65rem;
          color: var(--text-muted);
          white-space: nowrap;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        .projection-kpi .kpi-value {
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .projection-kpi .kpi-value.positive {
          color: var(--success);
        }

        /* Chart */
        .projection-chart-container {
          margin-bottom: 2rem;
        }

        .projection-chart-container h3 {
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 1rem;
        }

        .projection-chart {
          display: flex;
          gap: 0.5rem;
          background: linear-gradient(to bottom, #f8fafc 0%, transparent 100%);
          border-radius: 12px;
          padding: 1rem;
        }

        .chart-y-labels {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          font-size: 0.7rem;
          color: var(--text-muted);
          text-align: right;
          min-width: 50px;
          height: 250px;
          padding-right: 0.5rem;
        }

        .chart-main {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .chart-svg-wrapper {
          position: relative;
          height: 250px;
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

        .hover-line.past {
          background: #5b8def;
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

        .tooltip-label {
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--success);
          font-weight: 600;
          margin-bottom: 0.125rem;
        }

        .hover-tooltip.past .tooltip-label {
          color: #5b8def;
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
          color: var(--success);
        }

        .tooltip-value.past {
          color: #5b8def;
        }

        .tooltip-mult {
          font-size: 0.65rem;
          color: var(--text-secondary);
          margin-top: 0.125rem;
        }

        .chart-x-labels {
          position: relative;
          height: 30px;
          margin-top: 0.5rem;
          border-top: 1px solid #e2e8f0;
        }

        .x-label {
          position: absolute;
          transform: translateX(-50%);
          text-align: center;
          padding-top: 0.5rem;
        }

        .x-label-text {
          display: block;
          font-size: 0.65rem;
          color: var(--text-muted);
          font-weight: 500;
        }

        /* Milestones Table */
        .milestones-container {
          margin-bottom: 1.5rem;
        }

        .milestones-container h3 {
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 1rem;
        }

        .milestones-table {
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          overflow: hidden;
        }

        .milestones-header {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 1.5fr;
          gap: 1rem;
          padding: 0.875rem 1.25rem;
          background: #f8fafc;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .milestone-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 1.5fr;
          gap: 1rem;
          padding: 1rem 1.25rem;
          border-top: 1px solid #e2e8f0;
          transition: background 0.15s ease;
        }

        .milestone-row:hover {
          background: #f8fafc;
        }

        .milestone-row.next-milestone {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.04) 100%);
          border-left: 3px solid var(--success);
        }

        .milestone-target {
          font-weight: 700;
          color: var(--text-primary);
        }

        .milestone-multiplier {
          color: var(--success);
          font-weight: 600;
        }

        .milestone-days {
          color: var(--text-secondary);
          font-weight: 500;
        }

        .milestone-date {
          color: var(--text-secondary);
        }

        .projection-disclaimer {
          font-size: 0.75rem;
          color: var(--text-muted);
          font-style: italic;
          padding-top: 1rem;
          border-top: 1px solid #e2e8f0;
        }

        @media (max-width: 1200px) {
          .projection-kpis {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (max-width: 768px) {
          .projection-kpis {
            grid-template-columns: repeat(2, 1fr);
          }

          .milestones-header,
          .milestone-row {
            grid-template-columns: 1fr 1fr;
            gap: 0.5rem;
          }

          .milestones-header span:nth-child(3),
          .milestones-header span:nth-child(4),
          .milestone-row span:nth-child(3),
          .milestone-row span:nth-child(4) {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
