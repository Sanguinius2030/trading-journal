import { useState, useMemo } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { usePositions } from '../hooks/usePositions';
import { useIsMobile } from '../hooks/useIsMobile';

interface Position {
  entry_time: number;
  entry_date: string;
  pnl: number | null;
  realized_pnl?: number;
  is_closed: boolean;
}

interface DayData {
  date: Date;
  dateKey: string;
  pnl: number;
  pnlPercent: number;
  isToday: boolean;
  hasData: boolean;
  tradeCount: number;
  unrealizedPnl?: number;
}

export function CalendarHeatmap() {
  const { positions: rawPositions, balance } = usePositions();
  const isMobile = useIsMobile();
  const [isCollapsed, setIsCollapsed] = useState(true);

  // Cast positions to the local type
  const positions = rawPositions as unknown as Position[];

  // Convert balance to the expected format
  const balanceData = balance ? { unrealized_pnl: balance.unrealized_pnl || 0 } : null;

  const days = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Start from Dec 19, 2025 (when trading started)
    const startDate = new Date(2025, 11, 19); // Month is 0-indexed

    // Build a map of PnL and trade count by date
    const pnlByDate = new Map<string, { pnl: number; count: number }>();

    positions.forEach(position => {
      let positionPnl: number | null = null;
      if (position.is_closed && position.pnl !== null) {
        positionPnl = position.pnl;
      } else if (!position.is_closed && position.realized_pnl) {
        positionPnl = position.realized_pnl;
      }
      if (positionPnl === null) return;
      const datePart = position.entry_date.split(' ')[0];
      const current = pnlByDate.get(datePart) || { pnl: 0, count: 0 };
      pnlByDate.set(datePart, { pnl: current.pnl + positionPnl, count: current.count + 1 });
    });

    // Generate all days from start date to today
    // First pass: collect days in chronological order to calculate percentages
    const dayCount = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const chronologicalDays: { date: Date; dateKey: string; dayData: { pnl: number; count: number } | undefined }[] = [];

    for (let i = dayCount - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);

      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      const dateKey = `${day}/${month}/${year}`;

      chronologicalDays.push({
        date,
        dateKey,
        dayData: pnlByDate.get(dateKey)
      });
    }

    // Second pass: calculate percentages based on portfolio value at start of each day
    const STARTING_CAPITAL = 10000;
    let portfolioValue = STARTING_CAPITAL;
    const percentByDate = new Map<string, number>();

    chronologicalDays.forEach(day => {
      if (day.dayData) {
        const pnlPercent = (day.dayData.pnl / portfolioValue) * 100;
        percentByDate.set(day.dateKey, pnlPercent);
        portfolioValue += day.dayData.pnl;
      }
    });

    // Third pass: build result array in reverse order (most recent first)
    const result: DayData[] = [];
    const unrealizedPnl = balanceData?.unrealized_pnl || 0;

    for (let i = 0; i < dayCount; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);

      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      const dateKey = `${day}/${month}/${year}`;

      const dayData = pnlByDate.get(dateKey);
      const isToday = i === 0;

      // For today, include unrealized P&L
      const totalPnl = isToday ? (dayData?.pnl || 0) + unrealizedPnl : (dayData?.pnl || 0);
      const hasData = isToday ? (!!dayData || unrealizedPnl !== 0) : !!dayData;

      // Recalculate percentage for today if we have unrealized P&L
      let pnlPercent = percentByDate.get(dateKey) || 0;
      if (isToday && unrealizedPnl !== 0) {
        pnlPercent = (totalPnl / portfolioValue) * 100;
      }

      result.push({
        date,
        dateKey,
        pnl: totalPnl,
        pnlPercent,
        isToday,
        hasData,
        tradeCount: dayData?.count || 0,
        unrealizedPnl: isToday ? unrealizedPnl : undefined
      });
    }

    return result;
  }, [positions, balanceData]);

  // Calculate stats
  const STARTING_CAPITAL = 10000;
  const stats = useMemo(() => {
    const daysWithTrades = days.filter(d => d.hasData);
    const winningDays = daysWithTrades.filter(d => d.pnl > 0);
    const losingDays = daysWithTrades.filter(d => d.pnl < 0);
    const totalPnL = daysWithTrades.reduce((sum, d) => sum + d.pnl, 0);
    const maxWin = Math.max(...daysWithTrades.map(d => d.pnl), 0);
    const maxLoss = Math.min(...daysWithTrades.map(d => d.pnl), 0);

    // Calculate average PnL per trading day
    const avgPnlPerDay = daysWithTrades.length > 0
      ? totalPnL / daysWithTrades.length
      : 0;

    // Calculate daily returns based on previous day's portfolio value
    // Days are sorted most recent first, so we need to reverse for chronological order
    const chronologicalDays = [...days].reverse();
    let portfolioValue = STARTING_CAPITAL;
    let totalDailyReturnPct = 0;
    let tradingDaysCount = 0;

    chronologicalDays.forEach(day => {
      if (day.hasData) {
        // Calculate this day's return as percentage of portfolio at start of day
        const dailyReturnPct = (day.pnl / portfolioValue) * 100;
        totalDailyReturnPct += dailyReturnPct;
        tradingDaysCount++;
        // Update portfolio value for next day
        portfolioValue += day.pnl;
      }
    });

    const avgPnlPerDayPct = tradingDaysCount > 0
      ? totalDailyReturnPct / tradingDaysCount
      : 0;

    return {
      winningDaysCount: winningDays.length,
      losingDaysCount: losingDays.length,
      totalPnL,
      maxWin,
      maxLoss,
      tradingDays: daysWithTrades.length,
      avgPnlPerDay,
      avgPnlPerDayPct
    };
  }, [days]);

  // Get bar width percentage based on PnL
  const getBarWidth = (pnl: number) => {
    const maxAbs = Math.max(Math.abs(stats.maxWin), Math.abs(stats.maxLoss)) || 1;
    return Math.min((Math.abs(pnl) / maxAbs) * 100, 100);
  };

  const formatCurrency = (value: number) => {
    const prefix = value >= 0 ? '+' : '-';
    return `${prefix}$${Math.round(Math.abs(value)).toLocaleString()}`;
  };

  return (
    <div className="calendar-heatmap">
      {isMobile ? (
        <div className="collapsible-panel-header" onClick={() => setIsCollapsed(!isCollapsed)}>
          <div className="heatmap-header" style={{ marginBottom: 0, paddingBottom: 0, borderBottom: 'none' }}>
            <Calendar size={18} />
            <span>Daily P&L</span>
          </div>
          <button className={`panel-toggle ${isCollapsed ? '' : 'expanded'}`}>
            <ChevronDown size={18} />
          </button>
        </div>
      ) : (
        <div className="heatmap-header">
          <Calendar size={18} />
          <span>Daily P&L</span>
        </div>
      )}

      <div className={isMobile ? `collapsible-panel-content ${isCollapsed ? 'collapsed' : 'expanded'}` : ''}>
      <div className="heatmap-summary">
        <div className={`avg-daily ${stats.avgPnlPerDay >= 0 ? 'positive' : 'negative'}`}>
          <span className="avg-label">Avg P&L / Day</span>
          <span className="avg-value">
            {stats.avgPnlPerDay >= 0 ? '+' : '-'}${Math.round(Math.abs(stats.avgPnlPerDay))}
          </span>
          <span className="avg-pct">
            {stats.avgPnlPerDayPct >= 0 ? '+' : ''}{stats.avgPnlPerDayPct.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="days-list">
        {days.map((day) => (
          <div
            key={day.dateKey}
            className={`day-row ${day.isToday ? 'today' : ''} ${!day.hasData ? 'no-data' : ''}`}
          >
            <div className="day-date">
              <span className="day-name">
                {day.date.toLocaleDateString('en-US', { weekday: 'short' })}
              </span>
              <span className="day-num">{day.date.getDate()}</span>
            </div>
            <div className="day-bar-container">
              {day.hasData && (
                <div
                  className={`day-bar ${day.pnl >= 0 ? 'positive' : 'negative'}`}
                  style={{ width: `${getBarWidth(day.pnl)}%` }}
                />
              )}
            </div>
            <div className={`day-pnl ${day.pnl > 0 ? 'positive' : day.pnl < 0 ? 'negative' : ''}`}>
              {day.hasData ? (
                <>
                  <span className="pnl-amount">{formatCurrency(day.pnl)}</span>
                  <span className="pnl-pct">{day.pnlPercent >= 0 ? '+' : ''}{day.pnlPercent.toFixed(1)}%</span>
                </>
              ) : '-'}
            </div>
          </div>
        ))}
      </div>
      </div>

      <style>{`
        .calendar-heatmap {
          background: var(--bg-secondary);
          border-radius: 20px;
          padding: 1.25rem;
          box-shadow:
            8px 8px 16px var(--shadow-dark),
            -8px -8px 16px var(--shadow-light);
          position: sticky;
          top: 1.5rem;
          width: 240px;
          flex-shrink: 0;
          align-self: flex-start;
          max-height: calc(100vh - 3rem);
          overflow-y: auto;
        }

        .heatmap-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid var(--border);
        }

        .heatmap-header svg {
          color: var(--accent);
        }

        .heatmap-summary {
          text-align: center;
          margin-bottom: 1rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid var(--border);
        }

        .avg-daily {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.125rem;
          margin-bottom: 0.75rem;
        }

        .avg-label {
          font-size: 0.65rem;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 500;
        }

        .avg-value {
          font-size: 1.25rem;
          font-weight: 700;
        }

        .avg-pct {
          font-size: 0.75rem;
          font-weight: 500;
        }

        .avg-daily.positive .avg-value,
        .avg-daily.positive .avg-pct {
          color: var(--success);
        }

        .avg-daily.negative .avg-value,
        .avg-daily.negative .avg-pct {
          color: var(--danger);
        }

        .days-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .day-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0.5rem;
          border-radius: 6px;
          background: var(--bg-tertiary);
          transition: all 0.15s ease;
        }

        .day-row:hover {
          background: var(--bg-primary);
          transform: translateX(2px);
        }

        .day-row.today {
          background: rgba(91, 141, 239, 0.15);
          border: 1px solid var(--accent);
        }

        .day-row.no-data {
          opacity: 0.5;
        }

        .day-date {
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 32px;
        }

        .day-name {
          font-size: 0.6rem;
          font-weight: 500;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .day-num {
          font-size: 0.85rem;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1;
        }

        .day-bar-container {
          flex: 1;
          height: 8px;
          background: var(--bg-secondary);
          border-radius: 4px;
          overflow: hidden;
        }

        .day-bar {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .day-bar.positive {
          background: linear-gradient(90deg, rgba(16, 185, 129, 0.6), var(--success));
        }

        .day-bar.negative {
          background: linear-gradient(90deg, rgba(220, 38, 38, 0.6), var(--danger));
        }

        .day-pnl {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          min-width: 55px;
          text-align: right;
          color: var(--text-muted);
        }

        .day-pnl .pnl-amount {
          font-size: 0.75rem;
          font-weight: 600;
        }

        .day-pnl .pnl-pct {
          font-size: 0.6rem;
          font-weight: 500;
          opacity: 0.8;
        }

        .day-pnl.positive {
          color: var(--success);
        }

        .day-pnl.negative {
          color: var(--danger);
        }
      `}</style>
    </div>
  );
}
