import { useState } from 'react';
import { PortfolioChart } from './components/PortfolioChart';
import { TradesTimeline } from './components/TradesTimeline';
import { KPIMetrics } from './components/KPIMetrics';
import { GrowthProjection } from './components/GrowthProjection';
import { PnLDashboard } from './components/PnLDashboard';
import { TradeJournalForm } from './components/TradeJournalForm';
import { PasswordProtection } from './components/PasswordProtection';
import { mockTrades as initialTrades, portfolioSnapshots } from './mockData';
import type { Trade } from './types';
import { TrendingUp } from 'lucide-react';
import './App.css';

function App() {
  const [trades, setTrades] = useState<Trade[]>(initialTrades);
  const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'analysis' | 'projection'>('overview');

  const handleAddTrade = (newTrade: Trade) => {
    setTrades([...trades, newTrade]);
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
            <KPIMetrics trades={trades} />
            <PortfolioChart data={portfolioSnapshots} />
            <TradeJournalForm onAddTrade={handleAddTrade} />
          </div>
        )}

        {activeTab === 'trades' && (
          <div className="trades-tab">
            <TradeJournalForm onAddTrade={handleAddTrade} />
            <TradesTimeline trades={trades} />
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="analysis-tab">
            <PnLDashboard trades={trades} />
          </div>
        )}

        {activeTab === 'projection' && (
          <div className="projection-tab">
            <GrowthProjection trades={trades} />
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
