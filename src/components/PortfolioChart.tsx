import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import type { PortfolioSnapshot } from '../types';

interface PortfolioChartProps {
  data: PortfolioSnapshot[];
}

export const PortfolioChart = ({ data }: PortfolioChartProps) => {
  const formattedData = data.map(snapshot => ({
    date: format(snapshot.date, 'MMM dd'),
    fullDate: format(snapshot.date, 'MMM dd, yyyy'),
    value: snapshot.totalValue,
    pnl: snapshot.totalPnL
  }));

  return (
    <div className="chart-container">
      <h2>Portfolio Value Over Time</h2>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={formattedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="date"
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF' }}
          />
          <YAxis
            stroke="#9CA3AF"
            tick={{ fill: '#9CA3AF' }}
            tickFormatter={(value) => `$${value.toLocaleString()}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1F2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              color: '#F9FAFB'
            }}
            formatter={(value) => value ? [`$${value.toLocaleString()}`, 'Portfolio Value'] : ['', 'Portfolio Value']}
            labelFormatter={(label) => formattedData.find(d => d.date === label)?.fullDate || label}
          />
          <Legend wrapperStyle={{ color: '#9CA3AF' }} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#10B981"
            strokeWidth={2}
            dot={false}
            name="Portfolio Value"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
