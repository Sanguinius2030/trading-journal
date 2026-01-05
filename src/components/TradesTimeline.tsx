import { format } from 'date-fns';
import type { Trade } from '../types';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface TradesTimelineProps {
  trades: Trade[];
}

export const TradesTimeline = ({ trades }: TradesTimelineProps) => {
  const sortedTrades = [...trades].sort((a, b) =>
    b.entryDate.getTime() - a.entryDate.getTime()
  );

  return (
    <div className="trades-timeline">
      <h2>Trade History</h2>
      <div className="timeline-container">
        {sortedTrades.map((trade) => (
          <div key={trade.id} className={`trade-card ${trade.status}`}>
            <div className="trade-header">
              <div className="trade-symbol">
                {trade.type === 'long' ? (
                  <TrendingUp className="icon-long" size={20} />
                ) : (
                  <TrendingDown className="icon-short" size={20} />
                )}
                <span className="symbol">{trade.symbol}</span>
                <span className={`trade-type ${trade.type}`}>{trade.type.toUpperCase()}</span>
              </div>
              {trade.pnl !== undefined && (
                <div className={`pnl ${trade.pnl >= 0 ? 'positive' : 'negative'}`}>
                  {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                  <span className="pnl-percent">
                    ({trade.pnlPercent !== undefined && trade.pnlPercent >= 0 ? '+' : ''}
                    {trade.pnlPercent?.toFixed(2)}%)
                  </span>
                </div>
              )}
            </div>

            <div className="trade-details">
              <div className="detail-row">
                <span className="label">Entry:</span>
                <span className="value">${trade.entryPrice.toLocaleString()} × {trade.quantity}</span>
                <span className="date">{format(trade.entryDate, 'MMM dd, yyyy')}</span>
              </div>
              {trade.exitPrice && trade.exitDate && (
                <div className="detail-row">
                  <span className="label">Exit:</span>
                  <span className="value">${trade.exitPrice.toLocaleString()} × {trade.quantity}</span>
                  <span className="date">{format(trade.exitDate, 'MMM dd, yyyy')}</span>
                </div>
              )}
              {trade.status === 'open' && (
                <div className="status-badge open">OPEN POSITION</div>
              )}
            </div>

            {trade.reasoning && (
              <div className="trade-reasoning">
                <strong>Reasoning:</strong> {trade.reasoning}
              </div>
            )}

            {trade.notes && (
              <div className="trade-notes">
                <strong>Notes:</strong> {trade.notes}
              </div>
            )}

            <div className="trade-meta">
              <span className="category">{trade.tradeCategory}</span>
              <span className="exchange">{trade.exchange}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
