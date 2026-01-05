import type { Trade, KPIMetrics as KPIMetricsType } from '../types';
import { TrendingUp, Target, Award, BarChart3 } from 'lucide-react';

interface KPIMetricsProps {
  trades: Trade[];
}

export const KPIMetrics = ({ trades }: KPIMetricsProps) => {
  const calculateMetrics = (): KPIMetricsType => {
    const closedTrades = trades.filter(t => t.status === 'closed' && t.pnl !== undefined);
    const winningTrades = closedTrades.filter(t => t.pnl! > 0);
    const losingTrades = closedTrades.filter(t => t.pnl! < 0);

    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalWins = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));

    const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
    const avgPnL = closedTrades.length > 0 ? totalPnL / closedTrades.length : 0;
    const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

    const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.pnl!)) : 0;
    const largestLoss = losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.pnl!)) : 0;

    // Calculate average monthly gain
    const startingCapital = 10000;
    const totalPnLPercent = (totalPnL / startingCapital) * 100;

    // Estimate months (from first to last trade)
    const sortedTrades = closedTrades.sort((a, b) => a.entryDate.getTime() - b.entryDate.getTime());
    const monthsElapsed = sortedTrades.length > 0
      ? Math.max(1, (sortedTrades[sortedTrades.length - 1].exitDate!.getTime() - sortedTrades[0].entryDate.getTime()) / (1000 * 60 * 60 * 24 * 30))
      : 1;

    const avgMonthlyGain = totalPnL / monthsElapsed;
    const avgMonthlyGainPercent = totalPnLPercent / monthsElapsed;

    return {
      totalTrades: closedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      totalPnL,
      totalPnLPercent,
      averagePnL: avgPnL,
      averageWin: avgWin,
      averageLoss: avgLoss,
      profitFactor,
      largestWin,
      largestLoss,
      avgMonthlyGain,
      avgMonthlyGainPercent
    };
  };

  const metrics = calculateMetrics();

  return (
    <div className="kpi-metrics">
      <h2>Performance Metrics</h2>
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon">
            <BarChart3 size={24} />
          </div>
          <div className="metric-content">
            <div className="metric-label">Total P&L</div>
            <div className={`metric-value ${metrics.totalPnL >= 0 ? 'positive' : 'negative'}`}>
              ${metrics.totalPnL.toFixed(2)}
            </div>
            <div className="metric-sub">
              {metrics.totalPnLPercent >= 0 ? '+' : ''}{metrics.totalPnLPercent.toFixed(2)}%
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">
            <Target size={24} />
          </div>
          <div className="metric-content">
            <div className="metric-label">Win Rate</div>
            <div className="metric-value">{metrics.winRate.toFixed(1)}%</div>
            <div className="metric-sub">
              {metrics.winningTrades}W / {metrics.losingTrades}L
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">
            <TrendingUp size={24} />
          </div>
          <div className="metric-content">
            <div className="metric-label">Avg Monthly Gain</div>
            <div className={`metric-value ${metrics.avgMonthlyGain >= 0 ? 'positive' : 'negative'}`}>
              ${metrics.avgMonthlyGain.toFixed(2)}
            </div>
            <div className="metric-sub">
              {metrics.avgMonthlyGainPercent >= 0 ? '+' : ''}{metrics.avgMonthlyGainPercent.toFixed(2)}%/mo
            </div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon">
            <Award size={24} />
          </div>
          <div className="metric-content">
            <div className="metric-label">Profit Factor</div>
            <div className="metric-value">{metrics.profitFactor.toFixed(2)}</div>
            <div className="metric-sub">
              Avg Win: ${metrics.averageWin.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="metric-card secondary">
          <div className="metric-label">Average P&L per Trade</div>
          <div className={`metric-value ${metrics.averagePnL >= 0 ? 'positive' : 'negative'}`}>
            ${metrics.averagePnL.toFixed(2)}
          </div>
        </div>

        <div className="metric-card secondary">
          <div className="metric-label">Largest Win</div>
          <div className="metric-value positive">${metrics.largestWin.toFixed(2)}</div>
        </div>

        <div className="metric-card secondary">
          <div className="metric-label">Largest Loss</div>
          <div className="metric-value negative">${metrics.largestLoss.toFixed(2)}</div>
        </div>

        <div className="metric-card secondary">
          <div className="metric-label">Total Trades</div>
          <div className="metric-value">{metrics.totalTrades}</div>
        </div>
      </div>
    </div>
  );
};
