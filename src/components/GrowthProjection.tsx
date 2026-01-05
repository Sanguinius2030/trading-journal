import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { Trade } from '../types';

interface GrowthProjectionProps {
  trades: Trade[];
  startingCapital?: number;
}

export const GrowthProjection = ({ trades, startingCapital = 10000 }: GrowthProjectionProps) => {
  const calculateProjection = () => {
    const closedTrades = trades.filter(t => t.status === 'closed' && t.pnl !== undefined);

    if (closedTrades.length === 0) {
      return {
        data: [],
        avgMonthlyReturnPercent: 0,
        currentValue: startingCapital
      };
    }

    // Calculate current value
    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const currentValue = startingCapital + totalPnL;
    const totalReturnPercent = (totalPnL / startingCapital) * 100;

    // Calculate time elapsed
    const sortedTrades = [...closedTrades].sort((a, b) => a.entryDate.getTime() - b.entryDate.getTime());
    const firstTradeDate = sortedTrades[0].entryDate;
    const lastTradeDate = sortedTrades[sortedTrades.length - 1].exitDate!;
    const monthsElapsed = Math.max(1, (lastTradeDate.getTime() - firstTradeDate.getTime()) / (1000 * 60 * 60 * 24 * 30));

    // Calculate average monthly return
    const avgMonthlyReturnPercent = totalReturnPercent / monthsElapsed;

    // Project forward 12 months
    const projectionData = [];
    const today = new Date();

    // Add historical data point
    projectionData.push({
      month: 'Now',
      actual: currentValue,
      conservative: currentValue,
      average: currentValue,
      optimistic: currentValue,
      isProjection: false
    });

    // Project next 12 months
    for (let i = 1; i <= 12; i++) {
      const monthDate = new Date(today);
      monthDate.setMonth(monthDate.getMonth() + i);
      const monthLabel = `+${i}mo`;

      // Conservative: 50% of average monthly return
      const conservativeReturn = avgMonthlyReturnPercent * 0.5;
      const conservativeValue = currentValue * Math.pow(1 + conservativeReturn / 100, i);

      // Average: current monthly return rate
      const averageValue = currentValue * Math.pow(1 + avgMonthlyReturnPercent / 100, i);

      // Optimistic: 150% of average monthly return
      const optimisticReturn = avgMonthlyReturnPercent * 1.5;
      const optimisticValue = currentValue * Math.pow(1 + optimisticReturn / 100, i);

      projectionData.push({
        month: monthLabel,
        actual: null,
        conservative: conservativeValue,
        average: averageValue,
        optimistic: optimisticValue,
        isProjection: true
      });
    }

    return {
      data: projectionData,
      avgMonthlyReturnPercent,
      currentValue
    };
  };

  const projection = calculateProjection();

  if (projection.data.length === 0) {
    return (
      <div className="growth-projection">
        <h2>Growth Projection</h2>
        <p className="no-data">Not enough trade history to generate projections</p>
      </div>
    );
  }

  return (
    <div className="growth-projection">
      <h2>Growth Projection - Next 12 Months</h2>
      <div className="projection-summary">
        <p>
          Based on your average monthly return of <strong>{projection.avgMonthlyReturnPercent.toFixed(2)}%</strong>,
          here's how your portfolio could grow:
        </p>
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={projection.data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="month"
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF' }}
          />
          <YAxis
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF' }}
            tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1F2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              color: '#F9FAFB'
            }}
            formatter={(value) => value ? [`$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, ''] : ['', '']}
          />
          <Legend wrapperStyle={{ color: '#9CA3AF' }} />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#10B981"
            strokeWidth={3}
            dot={{ r: 6 }}
            name="Current Value"
          />
          <Line
            type="monotone"
            dataKey="conservative"
            stroke="#3B82F6"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            name="Conservative (50%)"
          />
          <Line
            type="monotone"
            dataKey="average"
            stroke="#8B5CF6"
            strokeWidth={2}
            dot={false}
            name="Average"
          />
          <Line
            type="monotone"
            dataKey="optimistic"
            stroke="#F59E0B"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            name="Optimistic (150%)"
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="projection-scenarios">
        <div className="scenario">
          <div className="scenario-label">Conservative</div>
          <div className="scenario-value">
            ${projection.data[12].conservative.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="scenario-desc">50% of avg monthly return</div>
        </div>
        <div className="scenario">
          <div className="scenario-label">Average</div>
          <div className="scenario-value">
            ${projection.data[12].average.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="scenario-desc">Current monthly return rate</div>
        </div>
        <div className="scenario">
          <div className="scenario-label">Optimistic</div>
          <div className="scenario-value">
            ${projection.data[12].optimistic.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="scenario-desc">150% of avg monthly return</div>
        </div>
      </div>
    </div>
  );
};
