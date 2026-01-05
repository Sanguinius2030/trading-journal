import { useState, useEffect } from 'react';
import { PortfolioChart } from './components/PortfolioChart';
import { TradesTimeline } from './components/TradesTimeline';
import { TradesTable } from './components/TradesTable';
import { KPIMetrics } from './components/KPIMetrics';
import { GrowthProjection } from './components/GrowthProjection';
import { PnLDashboard } from './components/PnLDashboard';
import { TradeJournalForm } from './components/TradeJournalForm';
import { PasswordProtection } from './components/PasswordProtection';
import { mockTrades as initialTrades, portfolioSnapshots } from './mockData';
import { useLighterTrades } from './hooks/useLighterTrades';
import type { Trade } from './types';
import { TrendingUp, RefreshCw, AlertCircle } from 'lucide-react';
import './App.css';

function App() {
  const [manualTrades, setManualTrades] = useState<Trade[]>(initialTrades);
  const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'table' | 'analysis' | 'projection'>('overview');

  // Fetch trades from Lighter DEX
  const { trades: lighterTrades, loading: lighterLoading, error: lighterError, refetch, isConfigured } = useLighterTrades();

  // Combine manual trades with Lighter trades
  const [allTrades, setAllTrades] = useState<Trade[]>(manualTrades);

  useEffect(() => {
    // Combine and deduplicate trades
    const combined = [...manualTrades, ...lighterTrades];
    // Sort by entry date (newest first)
    combined.sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime());
    setAllTrades(combined);
  }, [manualTrades, lighterTrades]);

  const handleAddTrade = (newTrade: Trade) => {
    setManualTrades([...manualTrades, newTrade]);
  };

  return (
    <PasswordProtection>
      <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="logo">
            <TrendingUp size={32} />
            <h1>Trading Journal</h1>
          </div>
          <p className="subtitle">Track, Analyze, and Optimize Your Trading Performance</p>

          {/* Lighter DEX Status */}
          <div className="lighter-status">
            {isConfigured && (
              <>
                {lighterLoading && (
                  <div className="status-indicator loading">
                    <RefreshCw size={16} className="spinning" />
                    <span>Syncing Lighter trades...</span>
                  </div>
                )}
                {lighterError && (
                  <div className="status-indicator error">
                    <AlertCircle size={16} />
                    <span>{lighterError}</span>
                  </div>
                )}
                {!lighterLoading && !lighterError && lighterTrades.length > 0 && (
                  <div className="status-indicator success">
                    <RefreshCw size={16} onClick={refetch} style={{ cursor: 'pointer' }} />
                    <span>{lighterTrades.length} trades from Lighter DEX</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <nav className="nav-tabs">
        <button
          className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`tab ${activeTab === 'trades' ? 'active' : ''}`}
          onClick={() => setActiveTab('trades')}
        >
          Trade Journal
        </button>
        <button
          className={`tab ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          Table View
        </button>
        <button
          className={`tab ${activeTab === 'analysis' ? 'active' : ''}`}
          onClick={() => setActiveTab('analysis')}
        >
          P&L Analysis
        </button>
        <button
          className={`tab ${activeTab === 'projection' ? 'active' : ''}`}
          onClick={() => setActiveTab('projection')}
        >
          Projection
        </button>
      </nav>

      <main className="main-content">
        {activeTab === 'overview' && (
          <div className="overview-tab">
            <KPIMetrics trades={allTrades} />
            <PortfolioChart data={portfolioSnapshots} />
            <TradeJournalForm onAddTrade={handleAddTrade} />
          </div>
        )}

        {activeTab === 'trades' && (
          <div className="trades-tab">
            <TradeJournalForm onAddTrade={handleAddTrade} />
            <TradesTimeline trades={allTrades} />
          </div>
        )}

        {activeTab === 'table' && (
          <div className="table-tab">
            <TradesTable trades={allTrades} />
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="analysis-tab">
            <PnLDashboard trades={allTrades} />
          </div>
        )}

        {activeTab === 'projection' && (
          <div className="projection-tab">
            <GrowthProjection trades={allTrades} />
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Trading Journal - Built with React & TypeScript</p>
        <p className="footer-note">Data from Hyperliquid & Lighter DEXs</p>
      </footer>
    </div>
    </PasswordProtection>
  );
}

export default App;
