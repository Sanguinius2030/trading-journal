import { useState, useEffect } from 'react';
import { PortfolioChart } from './components/PortfolioChart';
import { TradesTimeline } from './components/TradesTimeline';
import { PositionsTable } from './components/PositionsTable';
import { KPIMetrics } from './components/KPIMetrics';
import { GrowthProjection } from './components/GrowthProjection';
import { PnLDashboard } from './components/PnLDashboard';
import { TradeJournalForm } from './components/TradeJournalForm';
import { PasswordProtection } from './components/PasswordProtection';
import { portfolioSnapshots } from './mockData';
import { useLighterTrades } from './hooks/useLighterTrades';
import { aggregateTradesIntoPositions } from './services/positionAggregator';
import { updatePosition } from './services/supabase';
import type { Trade, Position } from './types';
import { TrendingUp, RefreshCw, AlertCircle } from 'lucide-react';
import './App.css';

function App() {
  // Start with empty manual trades - Lighter trades come from the API
  const [manualTrades, setManualTrades] = useState<Trade[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'table' | 'analysis' | 'projection'>('overview');

  // Fetch trades from Lighter DEX
  const { trades: lighterTrades, loading: lighterLoading, error: lighterError, refetch, isConfigured } = useLighterTrades();

  // Positions state
  const [positions, setPositions] = useState<Position[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);

  // Combine manual trades with Lighter trades
  const [allTrades, setAllTrades] = useState<Trade[]>(manualTrades);

  useEffect(() => {
    // Combine and deduplicate trades
    const combined = [...manualTrades, ...lighterTrades];
    // Sort by entry date (newest first)
    combined.sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime());
    setAllTrades(combined);
  }, [manualTrades, lighterTrades]);

  // Aggregate trades into positions when trades change
  useEffect(() => {
    const loadPositions = async () => {
      if (lighterTrades.length === 0) return;

      setPositionsLoading(true);
      try {
        const aggregatedPositions = await aggregateTradesIntoPositions();
        setPositions(aggregatedPositions);
      } catch (error) {
        console.error('Failed to aggregate positions:', error);
      } finally {
        setPositionsLoading(false);
      }
    };

    loadPositions();
  }, [lighterTrades]);

  const handleAddTrade = (newTrade: Trade) => {
    setManualTrades([...manualTrades, newTrade]);
  };

  const handleUpdatePosition = async (positionId: string, updates: { journal?: string; category?: string }) => {
    try {
      await updatePosition(positionId, updates);
      // Update local state
      setPositions(prev => prev.map(p =>
        p.id === positionId ? { ...p, ...updates } : p
      ));
    } catch (error) {
      console.error('Failed to update position:', error);
      throw error;
    }
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
            {positionsLoading ? (
              <div className="loading-positions">
                <RefreshCw size={24} className="spinning" />
                <span>Aggregating positions...</span>
              </div>
            ) : (
              <PositionsTable
                positions={positions}
                onUpdatePosition={handleUpdatePosition}
              />
            )}
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
