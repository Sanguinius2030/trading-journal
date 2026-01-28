import { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Target, Activity, Flame, BarChart3, Wallet, Settings, X, Check, ChevronDown } from 'lucide-react';
import { usePositions } from '../hooks/usePositions';
import { useIsMobile } from '../hooks/useIsMobile';

interface Trade {
  trade_id: number;
  timestamp: number;
  date_time: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  usd_amount: number;
}

interface AggregatedPosition {
  position_id: string;
  market_symbol: string;
  entry_time: number;
  exit_time: number | null;
  entry_date: string;
  exit_date: string | null;
  trades?: Trade[];
  trade_count?: number;
  max_position_size?: number;
  total_size?: number;
  avg_entry_price: number;
  avg_exit_price: number | null;
  total_entry_value: number;
  total_exit_value: number;
  pnl: number | null;
  total_funding?: number;
  position_type: 'LONG' | 'SHORT';
  is_closed: boolean;
}

interface BalanceData {
  account_index: number;
  balance: string;
  margin_balance: string;
  free_margin: string;
  margin_used: string;
  unrealized_pnl: number;
  fetched_at: string;
}

interface KPIData {
  winRate: number;
  profitFactor: number;
  expectancy: number;
  currentDrawdown: number;
  maxDrawdown: number;
  currentStreak: { count: number; type: 'W' | 'L' };
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
}

const STARTING_PORTFOLIO = 10000; // Started with $10k on Dec 19
const STORAGE_KEY = 'trading-journal-external-balance';
const FEES_STORAGE_KEY = 'trading-journal-fees-expenses';

function calculateKPIs(positions: AggregatedPosition[]): KPIData {
  const closedPositions = positions
    .filter(p => p.is_closed && p.pnl !== null)
    .sort((a, b) => (a.exit_time || 0) - (b.exit_time || 0));

  if (closedPositions.length === 0) {
    return {
      winRate: 0,
      profitFactor: 0,
      expectancy: 0,
      currentDrawdown: 0,
      maxDrawdown: 0,
      currentStreak: { count: 0, type: 'W' },
      totalPnL: 0,
      avgWin: 0,
      avgLoss: 0,
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
    };
  }

  const wins = closedPositions.filter(p => (p.pnl || 0) > 0);
  const losses = closedPositions.filter(p => (p.pnl || 0) <= 0);

  const totalWins = wins.reduce((sum, p) => sum + (p.pnl || 0), 0);
  const totalLosses = Math.abs(losses.reduce((sum, p) => sum + (p.pnl || 0), 0));

  const winRate = (wins.length / closedPositions.length) * 100;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
  const totalPnL = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
  const expectancy = totalPnL / closedPositions.length;

  // Calculate drawdown
  let runningPnL = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const pos of closedPositions) {
    runningPnL += pos.pnl || 0;
    if (runningPnL > peak) {
      peak = runningPnL;
    }
    const drawdown = peak - runningPnL;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const currentDrawdown = peak - runningPnL;

  // Calculate current streak
  let streakCount = 0;
  let streakType: 'W' | 'L' = 'W';

  for (let i = closedPositions.length - 1; i >= 0; i--) {
    const isWin = (closedPositions[i].pnl || 0) > 0;
    if (i === closedPositions.length - 1) {
      streakType = isWin ? 'W' : 'L';
      streakCount = 1;
    } else {
      const matchesStreak = isWin ? streakType === 'W' : streakType === 'L';
      if (matchesStreak) {
        streakCount++;
      } else {
        break;
      }
    }
  }

  return {
    winRate,
    profitFactor,
    expectancy,
    currentDrawdown,
    maxDrawdown,
    currentStreak: { count: streakCount, type: streakType },
    totalPnL,
    avgWin,
    avgLoss,
    totalTrades: closedPositions.length,
    winCount: wins.length,
    lossCount: losses.length,
  };
}

export function KPISidebar() {
  const { positions: rawPositions, loading, balance } = usePositions();
  const isMobile = useIsMobile();
  const [isCollapsed, setIsCollapsed] = useState(true);

  // Cast positions to the local type
  const positions = rawPositions as unknown as AggregatedPosition[];

  const [externalBalance, setExternalBalance] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseFloat(stored) : 8055;
  });
  const [feesExpenses, setFeesExpenses] = useState<number>(() => {
    const stored = localStorage.getItem(FEES_STORAGE_KEY);
    return stored ? parseFloat(stored) : 0;
  });
  const [editingExternal, setEditingExternal] = useState(false);
  const [editingFees, setEditingFees] = useState(false);
  const [tempExternalValue, setTempExternalValue] = useState('');
  const [tempFeesValue, setTempFeesValue] = useState('');

  // Convert balance to the expected format
  const balanceData: BalanceData | null = balance ? {
    account_index: 0,
    balance: String(balance.available_balance || 0),
    margin_balance: String(balance.account_equity || 0),
    free_margin: String(balance.available_balance || 0),
    margin_used: String(balance.margin_used || 0),
    unrealized_pnl: balance.unrealized_pnl || 0,
    fetched_at: balance.updated_at || new Date().toISOString(),
  } : null;

  const kpis = useMemo(() => calculateKPIs(positions), [positions]);

  // Calculate total funding received/paid
  const totalFunding = useMemo(() => {
    return positions.reduce((sum, p) => sum + (p.total_funding || 0), 0);
  }, [positions]);

  // Calculate portfolio metrics
  const portfolioMetrics = useMemo(() => {
    // Use margin_balance as it represents total account equity (balance + unrealized PnL already included)
    const lighterEquity = balanceData ? parseFloat(balanceData.margin_balance) : 0;
    const unrealizedPnl = balanceData ? balanceData.unrealized_pnl : 0;
    // Don't add unrealizedPnl separately - it's already in margin_balance
    const totalPortfolio = lighterEquity + externalBalance;
    const totalGain = totalPortfolio - STARTING_PORTFOLIO;
    const percentGain = ((totalPortfolio - STARTING_PORTFOLIO) / STARTING_PORTFOLIO) * 100;

    return {
      lighterBalance: lighterEquity,
      unrealizedPnl,
      externalBalance,
      totalPortfolio,
      totalGain,
      percentGain,
      feesExpenses,
      startingPortfolio: STARTING_PORTFOLIO,
    };
  }, [balanceData, externalBalance, feesExpenses]);

  const handleSaveExternal = () => {
    const value = parseFloat(tempExternalValue);
    if (!isNaN(value) && value >= 0) {
      setExternalBalance(value);
      localStorage.setItem(STORAGE_KEY, String(value));
    }
    setEditingExternal(false);
  };

  const handleSaveFees = () => {
    const value = parseFloat(tempFeesValue);
    if (!isNaN(value) && value >= 0) {
      setFeesExpenses(value);
      localStorage.setItem(FEES_STORAGE_KEY, String(value));
      // Dispatch event so other components can update
      window.dispatchEvent(new Event('fees-expenses-changed'));
    }
    setEditingFees(false);
  };

  const handleStartEdit = () => {
    setTempExternalValue(String(externalBalance));
    setEditingExternal(true);
  };

  const handleStartEditFees = () => {
    setTempFeesValue(String(feesExpenses));
    setEditingFees(true);
  };

  if (loading) {
    return (
      <div className="kpi-sidebar">
        <div className="kpi-sidebar-loading">Loading...</div>
      </div>
    );
  }

  const formatWholeNumber = (value: number) => {
    return Math.round(value).toLocaleString('en-US');
  };

  const formatCurrency = (value: number) => {
    const prefix = value >= 0 ? '+' : '';
    return `${prefix}$${formatWholeNumber(Math.abs(value))}`;
  };

  const formatDollar = (value: number) => {
    return `$${formatWholeNumber(value)}`;
  };

  const formatProfitFactor = (value: number) => {
    if (value === Infinity) return '\u221e';
    return value.toFixed(2) + 'x';
  };

  return (
    <div className="kpi-sidebar">
      {isMobile && (
        <div className="collapsible-panel-header" onClick={() => setIsCollapsed(!isCollapsed)}>
          <h3 className="kpi-sidebar-title" style={{ marginBottom: 0, paddingBottom: 0, borderBottom: 'none' }}>
            <Wallet size={18} />
            Portfolio & KPIs
          </h3>
          <button className={`panel-toggle ${isCollapsed ? '' : 'expanded'}`}>
            <ChevronDown size={18} />
          </button>
        </div>
      )}
      <div className={isMobile ? `collapsible-panel-content ${isCollapsed ? 'collapsed' : 'expanded'}` : ''}>
      {/* Portfolio Section */}
      <div className="kpi-section">
        {!isMobile && (
        <h3 className="kpi-sidebar-title">
          <Wallet size={18} />
          Portfolio
        </h3>
        )}

        <div className="kpi-cards">
          {/* Total Portfolio Value */}
          <div className={`kpi-card highlight ${portfolioMetrics.totalGain >= 0 ? 'positive' : 'negative'}`}>
            <div className="kpi-content">
              <span className="kpi-label">Total Value</span>
              <span className="kpi-value-large">{formatDollar(portfolioMetrics.totalPortfolio)}</span>
              <span className={`kpi-gain ${portfolioMetrics.totalGain >= 0 ? 'positive' : 'negative'}`}>
                {formatCurrency(portfolioMetrics.totalGain)} ({portfolioMetrics.percentGain >= 0 ? '+' : ''}{portfolioMetrics.percentGain.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* Lighter Balance */}
          <div className="kpi-card small">
            <div className="kpi-content">
              <span className="kpi-label">Lighter</span>
              <span className="kpi-value">{formatDollar(portfolioMetrics.lighterBalance)}</span>
            </div>
          </div>

          {/* External Balance (editable) */}
          <div className="kpi-card small editable">
            <div className="kpi-content">
              <span className="kpi-label">
                External
                {!editingExternal && (
                  <button className="edit-external-btn" onClick={handleStartEdit} title="Edit external balance">
                    <Settings size={12} />
                  </button>
                )}
              </span>
              {editingExternal ? (
                <div className="external-edit-row">
                  <span className="currency-prefix">$</span>
                  <input
                    type="number"
                    className="external-input"
                    value={tempExternalValue}
                    onChange={(e) => setTempExternalValue(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveExternal();
                      if (e.key === 'Escape') setEditingExternal(false);
                    }}
                  />
                  <button className="save-external-btn" onClick={handleSaveExternal}><Check size={14} /></button>
                  <button className="cancel-external-btn" onClick={() => setEditingExternal(false)}><X size={14} /></button>
                </div>
              ) : (
                <span className="kpi-value">{formatDollar(externalBalance)}</span>
              )}
            </div>
          </div>

          {/* Unrealized PnL - shown for visibility but already included in Lighter equity */}
          {portfolioMetrics.unrealizedPnl !== 0 && (
            <div className={`kpi-card small ${portfolioMetrics.unrealizedPnl >= 0 ? 'positive' : 'negative'}`}>
              <div className="kpi-content">
                <span className="kpi-label">Unrealized*</span>
                <span className={`kpi-value ${portfolioMetrics.unrealizedPnl >= 0 ? 'positive' : 'negative'}`}>
                  {formatCurrency(portfolioMetrics.unrealizedPnl)}
                </span>
              </div>
            </div>
          )}

          {/* Fees/Expenses (editable) - for withdrawal fees, transfer fees, etc. */}
          <div className="kpi-card small editable negative">
            <div className="kpi-content">
              <span className="kpi-label">
                Fees/Costs
                {!editingFees && (
                  <button className="edit-external-btn" onClick={handleStartEditFees} title="Edit fees and expenses">
                    <Settings size={12} />
                  </button>
                )}
              </span>
              {editingFees ? (
                <div className="external-edit-row">
                  <span className="currency-prefix">$</span>
                  <input
                    type="number"
                    className="external-input"
                    value={tempFeesValue}
                    onChange={(e) => setTempFeesValue(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveFees();
                      if (e.key === 'Escape') setEditingFees(false);
                    }}
                  />
                  <button className="save-external-btn" onClick={handleSaveFees}><Check size={14} /></button>
                  <button className="cancel-external-btn" onClick={() => setEditingFees(false)}><X size={14} /></button>
                </div>
              ) : (
                <span className="kpi-value negative">-{formatDollar(feesExpenses)}</span>
              )}
            </div>
          </div>
        </div>

        <div className="kpi-section-note">
          Started: {formatDollar(STARTING_PORTFOLIO)} (Dec 19)
        </div>
      </div>

      {/* Trading KPIs Section */}
      <div className="kpi-section">
        <h3 className="kpi-sidebar-title">
          <BarChart3 size={18} />
          Trading KPIs
        </h3>

        <div className="kpi-cards">
          {/* Total P&L (net of fees, including unrealized) */}
          {(() => {
            const netPnL = kpis.totalPnL + portfolioMetrics.unrealizedPnl - feesExpenses;
            return (
              <div className={`kpi-card has-tooltip ${netPnL >= 0 ? 'positive' : 'negative'}`}>
                <div className="kpi-icon">
                  {netPnL >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                </div>
                <div className="kpi-content">
                  <span className="kpi-label">Net P&L</span>
                  <span className={`kpi-value ${netPnL >= 0 ? 'positive' : 'negative'}`}>
                    {formatCurrency(netPnL)}
                  </span>
                  <span className="kpi-detail">
                    {totalFunding !== 0 && (
                      <span className={totalFunding >= 0 ? 'positive' : 'negative'}>
                        {totalFunding >= 0 ? '+' : ''}${Math.round(totalFunding)} funding
                      </span>
                    )}
                    {totalFunding !== 0 && feesExpenses > 0 && ' · '}
                    {feesExpenses > 0 && (
                      <span>-${formatWholeNumber(feesExpenses)} fees</span>
                    )}
                  </span>
                </div>
                <div className="kpi-tooltip">Total profit/loss from all trades, including unrealized gains, funding payments, minus fees and expenses.</div>
              </div>
            );
          })()}

          {/* Percentage P&L */}
          {(() => {
            const netPnL = kpis.totalPnL + portfolioMetrics.unrealizedPnl - feesExpenses;
            const pctPnL = (netPnL / STARTING_PORTFOLIO) * 100;
            return (
              <div className={`kpi-card has-tooltip ${pctPnL >= 0 ? 'positive' : 'negative'}`}>
                <div className="kpi-icon">
                  {pctPnL >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                </div>
                <div className="kpi-content">
                  <span className="kpi-label">Pct P&L</span>
                  <span className={`kpi-value ${pctPnL >= 0 ? 'positive' : 'negative'}`}>
                    {pctPnL >= 0 ? '+' : ''}{pctPnL.toFixed(2)}%
                  </span>
                  <span className="kpi-detail">of ${formatWholeNumber(STARTING_PORTFOLIO)}</span>
                </div>
                <div className="kpi-tooltip">Total percentage return on your starting capital of ${formatWholeNumber(STARTING_PORTFOLIO)}.</div>
              </div>
            );
          })()}

          {/* Win Rate */}
          <div className="kpi-card has-tooltip">
            <div className="kpi-icon">
              <Target size={16} />
            </div>
            <div className="kpi-content">
              <span className="kpi-label">Win Rate</span>
              <span className="kpi-value">{kpis.winRate.toFixed(1)}%</span>
              <span className="kpi-detail">{kpis.winCount}W / {kpis.lossCount}L</span>
            </div>
            <div className="kpi-tooltip">Percentage of profitable trades. Calculated as winning trades divided by total trades.</div>
          </div>

          {/* Profit Factor */}
          <div className={`kpi-card has-tooltip ${kpis.profitFactor >= 1 ? 'positive' : 'negative'}`}>
            <div className="kpi-icon">
              <Activity size={16} />
            </div>
            <div className="kpi-content">
              <span className="kpi-label">Profit Factor</span>
              <span className={`kpi-value ${kpis.profitFactor >= 1 ? 'positive' : 'negative'}`}>
                {formatProfitFactor(kpis.profitFactor)}
              </span>
            </div>
            <div className="kpi-tooltip">Ratio of gross profits to gross losses. Above 1.0 means you're profitable. Above 1.5 is considered good.</div>
          </div>

          {/* Expectancy */}
          <div className={`kpi-card has-tooltip ${kpis.expectancy >= 0 ? 'positive' : 'negative'}`}>
            <div className="kpi-icon">
              <TrendingUp size={16} />
            </div>
            <div className="kpi-content">
              <span className="kpi-label">Expectancy</span>
              <span className={`kpi-value ${kpis.expectancy >= 0 ? 'positive' : 'negative'}`}>
                {formatCurrency(kpis.expectancy)}
              </span>
              <span className="kpi-detail">per trade</span>
            </div>
            <div className="kpi-tooltip">Average amount you can expect to win or lose per trade. Positive expectancy means your strategy is profitable over time.</div>
          </div>

          {/* Current Drawdown */}
          <div className={`kpi-card has-tooltip ${kpis.currentDrawdown > 0 ? 'negative' : 'neutral'}`}>
            <div className="kpi-icon">
              <TrendingDown size={16} />
            </div>
            <div className="kpi-content">
              <span className="kpi-label">Drawdown</span>
              <span className={`kpi-value ${kpis.currentDrawdown > 0 ? 'negative' : ''}`}>
                -${formatWholeNumber(kpis.currentDrawdown)}
              </span>
              <span className="kpi-detail">max: -${formatWholeNumber(kpis.maxDrawdown)}</span>
            </div>
            <div className="kpi-tooltip">Current decline from your equity peak. Max drawdown shows the largest peak-to-trough drop in your trading history.</div>
          </div>

          {/* Current Streak */}
          <div className={`kpi-card has-tooltip ${kpis.currentStreak.type === 'W' ? 'positive' : 'negative'}`}>
            <div className="kpi-icon">
              <Flame size={16} />
            </div>
            <div className="kpi-content">
              <span className="kpi-label">Streak</span>
              <span className={`kpi-value ${kpis.currentStreak.type === 'W' ? 'positive' : 'negative'}`}>
                {kpis.currentStreak.count}{kpis.currentStreak.type}
              </span>
            </div>
            <div className="kpi-tooltip">Your current consecutive winning (W) or losing (L) streak. Helps identify momentum in your trading.</div>
          </div>

          {/* Avg Win */}
          <div className="kpi-card small positive has-tooltip">
            <div className="kpi-content">
              <span className="kpi-label">Avg Win</span>
              <span className="kpi-value positive">+${formatWholeNumber(kpis.avgWin)}</span>
            </div>
            <div className="kpi-tooltip">Average profit on winning trades. Higher is better - shows how much you capture when you're right.</div>
          </div>

          {/* Avg Loss */}
          <div className="kpi-card small negative has-tooltip">
            <div className="kpi-content">
              <span className="kpi-label">Avg Loss</span>
              <span className="kpi-value negative">-${formatWholeNumber(kpis.avgLoss)}</span>
            </div>
            <div className="kpi-tooltip">Average loss on losing trades. Lower is better - shows how well you manage risk and cut losses.</div>
          </div>
        </div>

        <div className="kpi-footer">
          <span>{kpis.totalTrades} closed trades</span>
        </div>
      </div>
      </div>
    </div>
  );
}
