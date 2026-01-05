import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import type { Trade } from '../types';

interface PnLDashboardProps {
  trades: Trade[];
}

export const PnLDashboard = ({ trades }: PnLDashboardProps) => {
  const closedTrades = trades.filter(t => t.status === 'closed' && t.pnl !== undefined);

  // P&L by category
  const pnlByCategory = closedTrades.reduce((acc, trade) => {
    const category = trade.tradeCategory || 'Other';
    if (!acc[category]) {
      acc[category] = { category, pnl: 0, trades: 0 };
    }
    acc[category].pnl += trade.pnl || 0;
    acc[category].trades += 1;
    return acc;
  }, {} as Record<string, { category: string; pnl: number; trades: number }>);

  const categoryData = Object.values(pnlByCategory).sort((a, b) => b.pnl - a.pnl);

  // P&L by exchange
  const pnlByExchange = closedTrades.reduce((acc, trade) => {
    const exchange = trade.exchange;
    if (!acc[exchange]) {
      acc[exchange] = { exchange, pnl: 0, trades: 0 };
    }
    acc[exchange].pnl += trade.pnl || 0;
    acc[exchange].trades += 1;
    return acc;
  }, {} as Record<string, { exchange: string; pnl: number; trades: number }>);

  const exchangeData = Object.values(pnlByExchange);

  // Win/Loss distribution
  const winningTrades = closedTrades.filter(t => t.pnl! > 0);
  const losingTrades = closedTrades.filter(t => t.pnl! < 0);
  const totalWins = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));

  const winLossData = [
    { name: 'Winning Trades', value: totalWins, count: winningTrades.length },
    { name: 'Losing Trades', value: totalLosses, count: losingTrades.length }
  ];

  const COLORS = {
    win: '#10B981',
    loss: '#EF4444'
  };

  return (
    <div className="pnl-dashboard">
      <h2>P&L Analysis</h2>

      <div className="pnl-charts">
        <div className="chart-section">
          <h3>P&L by Trade Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={categoryData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="category"
                stroke="#9CA3AF"
                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis
                stroke="#9CA3AF"
                tick={{ fill: '#9CA3AF' }}
                tickFormatter={(value) => `$${value}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#F9FAFB'
                }}
                formatter={(value, _name, props: any) => {
                  if (typeof value === 'number') {
                    return [`$${value.toFixed(2)} (${props.payload.trades} trades)`, 'P&L'];
                  }
                  return ['', 'P&L'];
                }}
              />
              <Bar
                dataKey="pnl"
                fill="#8B5CF6"
                radius={[8, 8, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-section">
          <h3>Win/Loss Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={winLossData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry: any) => `${entry.name}: $${entry.value.toFixed(0)} (${entry.count})`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                <Cell fill={COLORS.win} />
                <Cell fill={COLORS.loss} />
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#F9FAFB'
                }}
                formatter={(value) => typeof value === 'number' ? `$${value.toFixed(2)}` : ''}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-section">
          <h3>P&L by Exchange</h3>
          <div className="exchange-breakdown">
            {exchangeData.map((exchange) => (
              <div key={exchange.exchange} className="exchange-item">
                <div className="exchange-name">{exchange.exchange}</div>
                <div className="exchange-stats">
                  <div className={`exchange-pnl ${exchange.pnl >= 0 ? 'positive' : 'negative'}`}>
                    {exchange.pnl >= 0 ? '+' : ''}${exchange.pnl.toFixed(2)}
                  </div>
                  <div className="exchange-trades">{exchange.trades} trades</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
