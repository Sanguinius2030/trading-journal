import type { Trade } from '../types';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';

interface TradesTableProps {
  trades: Trade[];
}

export const TradesTable = ({ trades }: TradesTableProps) => {
  const sortedTrades = [...trades].sort((a, b) =>
    new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime()
  );

  return (
    <div className="trades-table-container">
      <h2>All Trades</h2>

      <div className="table-wrapper">
        <table className="trades-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Symbol</th>
              <th>Type</th>
              <th>Status</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Quantity</th>
              <th>P&L</th>
              <th>P&L %</th>
              <th>Exchange</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.map((trade) => (
              <tr key={trade.id}>
                <td className="date-cell">
                  {format(new Date(trade.entryDate), 'MMM dd, yyyy')}
                </td>
                <td className="symbol-cell">
                  <div className="symbol-wrapper">
                    {trade.type === 'long' ? (
                      <TrendingUp size={16} className="icon-long" />
                    ) : (
                      <TrendingDown size={16} className="icon-short" />
                    )}
                    <span className="symbol-text">{trade.symbol}</span>
                  </div>
                </td>
                <td>
                  <span className={`trade-type ${trade.type}`}>
                    {trade.type}
                  </span>
                </td>
                <td>
                  <span className={`status-badge ${trade.status}`}>
                    {trade.status}
                  </span>
                </td>
                <td className="price-cell">${(trade.entryPrice || 0).toLocaleString()}</td>
                <td className="price-cell">
                  {trade.exitPrice ? `$${trade.exitPrice.toLocaleString()}` : '-'}
                </td>
                <td className="quantity-cell">{trade.quantity || 0}</td>
                <td className={`pnl-cell ${trade.pnl !== undefined ? (trade.pnl >= 0 ? 'positive' : 'negative') : ''}`}>
                  {trade.pnl !== undefined ? (
                    `${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toLocaleString()}`
                  ) : (
                    '-'
                  )}
                </td>
                <td className={`pnl-cell ${trade.pnlPercent !== undefined ? (trade.pnlPercent >= 0 ? 'positive' : 'negative') : ''}`}>
                  {trade.pnlPercent !== undefined ? (
                    `${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%`
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  <span className="exchange">{trade.exchange}</span>
                </td>
                <td>
                  {trade.tradeCategory && (
                    <span className="category">{trade.tradeCategory}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
