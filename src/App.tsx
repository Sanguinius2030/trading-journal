import { useState } from 'react';
import { AggregatedPositionsTable } from './components/AggregatedPositionsTable';
import { KPISidebar } from './components/KPISidebar';
import { CalendarHeatmap } from './components/CalendarHeatmap';
import { CalendarTab } from './components/CalendarTab';
import { StatsTab } from './components/StatsTab';
import { ChartsTab } from './components/ChartsTab';
import { GrowthProjection } from './components/GrowthProjection';
import { TaxTab } from './components/TaxTab';
import { AuthProvider, useAuthContext, isAuthRequired } from './components/Auth/AuthProvider';
import { LoginPage } from './components/Auth/LoginPage';
import { SettingsPage } from './components/Settings/SettingsPage';
import { TrendingUp, RefreshCw, LayoutDashboard, Target, Calendar, BarChart3, LineChart, Receipt, Settings, LogOut, Loader2 } from 'lucide-react';
import './App.css';

type Tab = 'dashboard' | 'stats' | 'charts' | 'calendar' | 'projection' | 'tax' | 'settings';

function AppContent() {
  const { user, loading, signOut, session } = useAuthContext();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="app-loading">
        <Loader2 size={48} className="spinning" />
        <p>Loading...</p>
      </div>
    );
  }

  // In production, require authentication
  if (isAuthRequired() && !user) {
    return <LoginPage />;
  }

  const handleSyncData = async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    setSyncStatus(null);

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      // In production, include auth token
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch('/api/sync-trades', {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        // If API not available (local dev without Vercel), show instructions
        if (response.status === 404) {
          throw new Error('Run "npx tsx scripts/fetch-all-trades.ts && npx tsx scripts/aggregate-positions.ts" to refresh data locally');
        }
        throw new Error(`Sync failed: ${response.status}`);
      }

      const data = await response.json();

      // Store the synced data in localStorage for persistence
      localStorage.setItem('aggregated-positions', JSON.stringify(data));

      const tradesInfo = data.summary.total_trades_fetched ? ` from ${data.summary.total_trades_fetched} trades` : '';
      const isPartial = data.summary.fetch_complete === false;

      if (isPartial && data.summary.total_positions === 0) {
        // Timeout with no usable data - suggest seed script
        setSyncStatus({
          type: 'error',
          message: data.summary.message || 'Sync timed out. Run the seed script locally to upload data.'
        });
      } else {
        setSyncStatus({
          type: isPartial ? 'error' : 'success',
          message: isPartial
            ? `Partial sync: ${data.summary.total_positions} positions${tradesInfo} (timed out - run seed script for full data)`
            : `Synced ${data.summary.total_positions} positions (${data.summary.closed_positions} closed, ${data.summary.open_positions} open)${tradesInfo}`
        });

        // Increment refresh key to trigger component re-mount and data re-fetch
        setTimeout(() => {
          setRefreshKey(prev => prev + 1);
          // Clear success message after components refresh
          setTimeout(() => setSyncStatus(null), 3000);
        }, 800);
      }
    } catch (error) {
      console.error('Sync error:', error);
      setSyncStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to sync data'
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-top">
            <div className="logo">
              <TrendingUp size={32} />
              <h1>Trading Journal</h1>
            </div>
            <div className="header-actions">
              <button
                className={`sync-button ${isSyncing ? 'syncing' : ''}`}
                onClick={handleSyncData}
                disabled={isSyncing}
              >
                <RefreshCw size={18} className={isSyncing ? 'spinning' : ''} />
                {isSyncing ? 'Syncing...' : 'Refresh Data'}
              </button>
              {user && (
                <button className="logout-button" onClick={handleLogout} title="Logout">
                  <LogOut size={18} />
                </button>
              )}
            </div>
          </div>
          <p className="subtitle">Track, Analyze, and Optimize Your Trading Performance</p>
          {user && (
            <p className="user-email">{user.email}</p>
          )}
          {syncStatus && (
            <div className={`sync-status ${syncStatus.type}`}>
              {syncStatus.message}
            </div>
          )}
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="tab-navigation">
        <button
          className={`tab-button ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <LayoutDashboard size={18} />
          Dashboard
        </button>
        <button
          className={`tab-button ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          <BarChart3 size={18} />
          Stats
        </button>
        <button
          className={`tab-button ${activeTab === 'charts' ? 'active' : ''}`}
          onClick={() => setActiveTab('charts')}
        >
          <LineChart size={18} />
          Charts
        </button>
        <button
          className={`tab-button ${activeTab === 'calendar' ? 'active' : ''}`}
          onClick={() => setActiveTab('calendar')}
        >
          <Calendar size={18} />
          Calendar
        </button>
        <button
          className={`tab-button ${activeTab === 'projection' ? 'active' : ''}`}
          onClick={() => setActiveTab('projection')}
        >
          <Target size={18} />
          Projection
        </button>
        <button
          className={`tab-button ${activeTab === 'tax' ? 'active' : ''}`}
          onClick={() => setActiveTab('tax')}
        >
          <Receipt size={18} />
          Tax
        </button>
        {user && (
          <button
            className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={18} />
            Settings
          </button>
        )}
      </nav>

      {activeTab === 'dashboard' && (
        <main className="app-layout" key={`dashboard-${refreshKey}`}>
          <KPISidebar />
          <div className="main-column">
            <div className="positions-tab">
              <AggregatedPositionsTable />
            </div>
          </div>
          <CalendarHeatmap />
        </main>
      )}

      {activeTab === 'stats' && (
        <main className="stats-layout" key={`stats-${refreshKey}`}>
          <StatsTab />
        </main>
      )}

      {activeTab === 'charts' && (
        <main className="charts-layout" key={`charts-${refreshKey}`}>
          <ChartsTab />
        </main>
      )}

      {activeTab === 'calendar' && (
        <main className="calendar-layout" key={`calendar-${refreshKey}`}>
          <CalendarTab />
        </main>
      )}

      {activeTab === 'projection' && (
        <main className="projection-layout" key={`projection-${refreshKey}`}>
          <GrowthProjection />
        </main>
      )}

      {activeTab === 'tax' && (
        <main className="tax-layout" key={`tax-${refreshKey}`}>
          <TaxTab />
        </main>
      )}

      {activeTab === 'settings' && user && (
        <main className="settings-layout" key={`settings-${refreshKey}`}>
          <SettingsPage />
        </main>
      )}

      <footer className="app-footer">
        <p>Trading Journal - Built with React & TypeScript</p>
        <p className="footer-note">Data from Lighter DEX</p>
      </footer>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
