import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar, TrendingUp, TrendingDown } from 'lucide-react';
import { usePositions } from '../hooks/usePositions';

interface Position {
  entry_time: number;
  entry_date: string;
  pnl: number | null;
  is_closed: boolean;
  position_type: 'LONG' | 'SHORT';
  market_symbol: string;
}

interface DayData {
  date: Date;
  dateKey: string;
  pnl: number;
  hasData: boolean;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export function CalendarTab() {
  const { positions: rawPositions } = usePositions();
  const positions = rawPositions as unknown as Position[];

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);

  // Build PnL map by date
  const pnlByDate = useMemo(() => {
    const map = new Map<string, { pnl: number; count: number; wins: number; losses: number }>();

    positions.forEach(position => {
      if (!position.is_closed || position.pnl === null) return;
      const datePart = position.entry_date.split(' ')[0];
      const current = map.get(datePart) || { pnl: 0, count: 0, wins: 0, losses: 0 };
      map.set(datePart, {
        pnl: current.pnl + position.pnl,
        count: current.count + 1,
        wins: current.wins + (position.pnl > 0 ? 1 : 0),
        losses: current.losses + (position.pnl < 0 ? 1 : 0)
      });
    });

    return map;
  }, [positions]);

  // Get calendar days for current month view
  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = new Date();

    // First day of the month
    const firstDay = new Date(year, month, 1);
    // Last day of the month
    const lastDay = new Date(year, month + 1, 0);

    // Start from Monday of the week containing the first day
    const startDate = new Date(firstDay);
    const dayOfWeek = firstDay.getDay();
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0 offset
    startDate.setDate(firstDay.getDate() - daysToSubtract);

    // End on Sunday of the week containing the last day
    const endDate = new Date(lastDay);
    const lastDayOfWeek = lastDay.getDay();
    const daysToAdd = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
    endDate.setDate(lastDay.getDate() + daysToAdd);

    const days: DayData[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const day = current.getDate().toString().padStart(2, '0');
      const m = (current.getMonth() + 1).toString().padStart(2, '0');
      const y = current.getFullYear();
      const dateKey = `${day}/${m}/${y}`;

      const dayData = pnlByDate.get(dateKey);

      days.push({
        date: new Date(current),
        dateKey,
        pnl: dayData?.pnl || 0,
        hasData: !!dayData,
        tradeCount: dayData?.count || 0,
        winCount: dayData?.wins || 0,
        lossCount: dayData?.losses || 0,
        isCurrentMonth: current.getMonth() === month,
        isToday: current.toDateString() === today.toDateString()
      });

      current.setDate(current.getDate() + 1);
    }

    return days;
  }, [currentDate, pnlByDate]);

  // Calculate monthly stats
  const monthStats = useMemo(() => {
    const monthDays = calendarDays.filter(d => d.isCurrentMonth && d.hasData);
    const totalPnL = monthDays.reduce((sum, d) => sum + d.pnl, 0);
    const winningDays = monthDays.filter(d => d.pnl > 0).length;
    const losingDays = monthDays.filter(d => d.pnl < 0).length;
    const totalTrades = monthDays.reduce((sum, d) => sum + d.tradeCount, 0);
    const bestDay = monthDays.length > 0 ? Math.max(...monthDays.map(d => d.pnl)) : 0;
    const worstDay = monthDays.length > 0 ? Math.min(...monthDays.map(d => d.pnl)) : 0;

    return {
      totalPnL,
      winningDays,
      losingDays,
      tradingDays: monthDays.length,
      totalTrades,
      winRate: monthDays.length > 0 ? (winningDays / monthDays.length) * 100 : 0,
      bestDay,
      worstDay
    };
  }, [calendarDays]);

  // Calculate color intensity based on PnL
  const getColorStyle = (day: DayData): { style: React.CSSProperties; needsLightText: boolean } => {
    if (!day.hasData) return { style: {}, needsLightText: false };

    const allPnLs = calendarDays.filter(d => d.hasData).map(d => Math.abs(d.pnl));
    const maxPnL = Math.max(...allPnLs, 1);
    const intensity = Math.min(Math.abs(day.pnl) / maxPnL, 1);
    const needsLightText = intensity > 0.4; // Use white text when background is dark enough

    if (day.pnl > 0) {
      // Green gradient
      const alpha = 0.15 + intensity * 0.65;
      return { style: { backgroundColor: `rgba(16, 185, 129, ${alpha})` }, needsLightText };
    } else if (day.pnl < 0) {
      // Red gradient
      const alpha = 0.15 + intensity * 0.65;
      return { style: { backgroundColor: `rgba(220, 38, 38, ${alpha})` }, needsLightText };
    }
    return { style: {}, needsLightText: false };
  };

  const navigateMonth = (direction: number) => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + direction);
      return newDate;
    });
    setSelectedDay(null);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDay(null);
  };

  const formatCurrency = (value: number) => {
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}$${Math.round(value).toLocaleString()}`;
  };

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="calendar-tab">
      <div className="calendar-container">
        {/* Header */}
        <div className="calendar-header">
          <div className="calendar-title">
            <Calendar size={24} />
            <h2>Trading Calendar</h2>
          </div>
          <div className="calendar-nav">
            <button onClick={() => navigateMonth(-1)} className="nav-btn">
              <ChevronLeft size={20} />
            </button>
            <h3 className="current-month">
              {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h3>
            <button onClick={() => navigateMonth(1)} className="nav-btn">
              <ChevronRight size={20} />
            </button>
            <button onClick={goToToday} className="today-btn">Today</button>
          </div>
        </div>

        {/* Monthly Stats */}
        <div className="month-stats">
          <div className={`stat-card main ${monthStats.totalPnL >= 0 ? 'positive' : 'negative'}`}>
            <span className="stat-label">Month P&L</span>
            <span className="stat-value">{formatCurrency(monthStats.totalPnL)}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Trading Days</span>
            <span className="stat-value">{monthStats.tradingDays}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Win Rate</span>
            <span className="stat-value">{monthStats.winRate.toFixed(0)}%</span>
          </div>
          <div className="stat-card positive">
            <span className="stat-label">Winning Days</span>
            <span className="stat-value">{monthStats.winningDays}</span>
          </div>
          <div className="stat-card negative">
            <span className="stat-label">Losing Days</span>
            <span className="stat-value">{monthStats.losingDays}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Total Trades</span>
            <span className="stat-value">{monthStats.totalTrades}</span>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="calendar-grid">
          {/* Weekday headers */}
          <div className="weekday-headers">
            {weekDays.map(day => (
              <div key={day} className="weekday-header">{day}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="days-grid">
            {calendarDays.map((day, index) => {
              const colorInfo = getColorStyle(day);
              return (
              <div
                key={index}
                className={`day-cell ${!day.isCurrentMonth ? 'other-month' : ''} ${day.isToday ? 'today' : ''} ${day.hasData ? 'has-data' : ''} ${selectedDay?.dateKey === day.dateKey ? 'selected' : ''} ${colorInfo.needsLightText ? 'light-text' : ''}`}
                style={day.isCurrentMonth ? colorInfo.style : {}}
                onClick={() => day.hasData && setSelectedDay(day)}
              >
                <span className="day-number">{day.date.getDate()}</span>
                {day.hasData && day.isCurrentMonth && (
                  <span className="day-pnl">
                    {formatCurrency(day.pnl)}
                  </span>
                )}
                {day.hasData && day.isCurrentMonth && (
                  <span className="day-trades">{day.tradeCount} trade{day.tradeCount !== 1 ? 's' : ''}</span>
                )}
              </div>
            );
            })}
          </div>
        </div>

        {/* Color Legend */}
        <div className="color-legend">
          <div className="legend-item">
            <div className="legend-gradient negative"></div>
            <span>Loss</span>
          </div>
          <div className="legend-item">
            <div className="legend-box neutral"></div>
            <span>No trades</span>
          </div>
          <div className="legend-item">
            <div className="legend-gradient positive"></div>
            <span>Profit</span>
          </div>
        </div>
      </div>

      {/* Selected Day Details */}
      {selectedDay && (
        <div className="day-details">
          <div className="details-header">
            <h3>{selectedDay.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h3>
            <button className="close-btn" onClick={() => setSelectedDay(null)}>&times;</button>
          </div>
          <div className="details-stats">
            <div className={`detail-stat main ${selectedDay.pnl >= 0 ? 'positive' : 'negative'}`}>
              <span className="detail-label">Day P&L</span>
              <span className="detail-value">{formatCurrency(selectedDay.pnl)}</span>
            </div>
            <div className="detail-stat">
              <span className="detail-label">Total Trades</span>
              <span className="detail-value">{selectedDay.tradeCount}</span>
            </div>
            <div className="detail-stat positive">
              <TrendingUp size={16} />
              <span className="detail-label">Winners</span>
              <span className="detail-value">{selectedDay.winCount}</span>
            </div>
            <div className="detail-stat negative">
              <TrendingDown size={16} />
              <span className="detail-label">Losers</span>
              <span className="detail-value">{selectedDay.lossCount}</span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .calendar-tab {
          display: flex;
          gap: 1.5rem;
          max-width: 1400px;
          margin: 0 auto;
        }

        .calendar-container {
          flex: 1;
          background: white;
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          border: 1px solid #f1f5f9;
        }

        .calendar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .calendar-title {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .calendar-title h2 {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        .calendar-title svg {
          color: var(--accent);
        }

        .calendar-nav {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .nav-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: white;
          cursor: pointer;
          transition: all 0.15s;
        }

        .nav-btn:hover {
          background: #f8fafc;
          border-color: var(--accent);
          color: var(--accent);
        }

        .current-month {
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--text-primary);
          min-width: 180px;
          text-align: center;
          margin: 0;
        }

        .today-btn {
          padding: 0.5rem 1rem;
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          margin-left: 0.5rem;
        }

        .today-btn:hover {
          background: #4a7de0;
        }

        /* Month Stats */
        .month-stats {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .stat-card {
          background: #f8fafc;
          border-radius: 12px;
          padding: 1rem;
          text-align: center;
          border: 1px solid #e2e8f0;
        }

        .stat-card.main {
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        }

        .stat-card.main.positive {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%);
          border-color: rgba(16, 185, 129, 0.3);
        }

        .stat-card.main.negative {
          background: linear-gradient(135deg, rgba(220, 38, 38, 0.1) 0%, rgba(220, 38, 38, 0.05) 100%);
          border-color: rgba(220, 38, 38, 0.3);
        }

        .stat-label {
          display: block;
          font-size: 0.7rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin-bottom: 0.25rem;
        }

        .stat-value {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .stat-card.main.positive .stat-value {
          color: var(--success);
        }

        .stat-card.main.negative .stat-value {
          color: var(--danger);
        }

        .stat-card.positive .stat-value {
          color: var(--success);
        }

        .stat-card.negative .stat-value {
          color: var(--danger);
        }

        /* Calendar Grid */
        .calendar-grid {
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          overflow: hidden;
        }

        .weekday-headers {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
        }

        .weekday-header {
          padding: 0.75rem;
          text-align: center;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .days-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
        }

        .day-cell {
          min-height: 100px;
          padding: 0.5rem;
          border-right: 1px solid #e2e8f0;
          border-bottom: 1px solid #e2e8f0;
          background: white;
          cursor: default;
          transition: all 0.15s;
          display: flex;
          flex-direction: column;
        }

        .day-cell:nth-child(7n) {
          border-right: none;
        }

        .day-cell:nth-last-child(-n+7) {
          border-bottom: none;
        }

        .day-cell.other-month {
          background: #f8fafc;
          opacity: 0.5;
        }

        .day-cell.today {
          box-shadow: inset 0 0 0 2px var(--accent);
        }

        .day-cell.has-data {
          cursor: pointer;
        }

        .day-cell.has-data:hover {
          transform: scale(1.02);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          z-index: 1;
        }

        .day-cell.selected {
          box-shadow: inset 0 0 0 2px var(--accent), 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .day-number {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 0.25rem;
        }

        .day-cell.other-month .day-number {
          color: var(--text-muted);
        }

        .day-pnl {
          font-size: 0.8rem;
          font-weight: 700;
          margin-top: auto;
          color: var(--text-primary);
        }

        .day-trades {
          font-size: 0.65rem;
          color: var(--text-muted);
        }

        /* Light text for dark backgrounds */
        .day-cell.light-text .day-number,
        .day-cell.light-text .day-pnl,
        .day-cell.light-text .day-trades {
          color: white;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        /* Color Legend */
        .color-legend {
          display: flex;
          justify-content: center;
          gap: 2rem;
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid #e2e8f0;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .legend-gradient {
          width: 60px;
          height: 12px;
          border-radius: 4px;
        }

        .legend-gradient.positive {
          background: linear-gradient(90deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.8));
        }

        .legend-gradient.negative {
          background: linear-gradient(90deg, rgba(220, 38, 38, 0.8), rgba(220, 38, 38, 0.2));
        }

        .legend-box {
          width: 24px;
          height: 12px;
          border-radius: 4px;
          border: 1px solid #e2e8f0;
        }

        .legend-box.neutral {
          background: white;
        }

        /* Day Details Panel */
        .day-details {
          width: 300px;
          background: white;
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          border: 1px solid #f1f5f9;
          align-self: flex-start;
          position: sticky;
          top: 1.5rem;
        }

        .details-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid #e2e8f0;
        }

        .details-header h3 {
          font-size: 1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
          line-height: 1.4;
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 1.5rem;
          color: var(--text-muted);
          cursor: pointer;
          line-height: 1;
          padding: 0;
        }

        .close-btn:hover {
          color: var(--text-primary);
        }

        .details-stats {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .detail-stat {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem;
          background: #f8fafc;
          border-radius: 8px;
        }

        .detail-stat.main {
          padding: 1rem;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
        }

        .detail-stat.main.positive {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%);
        }

        .detail-stat.main.negative {
          background: linear-gradient(135deg, rgba(220, 38, 38, 0.1) 0%, rgba(220, 38, 38, 0.05) 100%);
        }

        .detail-stat.main .detail-value {
          font-size: 1.5rem;
        }

        .detail-stat.main.positive .detail-value {
          color: var(--success);
        }

        .detail-stat.main.negative .detail-value {
          color: var(--danger);
        }

        .detail-label {
          font-size: 0.75rem;
          color: var(--text-muted);
          flex: 1;
        }

        .detail-value {
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .detail-stat.positive svg {
          color: var(--success);
        }

        .detail-stat.negative svg {
          color: var(--danger);
        }

        .detail-stat.positive .detail-value {
          color: var(--success);
        }

        .detail-stat.negative .detail-value {
          color: var(--danger);
        }

        @media (max-width: 1200px) {
          .month-stats {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (max-width: 900px) {
          .calendar-tab {
            flex-direction: column;
          }

          .day-details {
            width: 100%;
            position: static;
          }

          .day-cell {
            min-height: 80px;
          }

          .month-stats {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 600px) {
          .day-cell {
            min-height: 60px;
            padding: 0.25rem;
          }

          .day-pnl {
            font-size: 0.65rem;
          }

          .day-trades {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
