import { useState, useEffect } from 'react';
import { Settings, Save, Key, DollarSign, AlertCircle, CheckCircle, Loader2, HelpCircle } from 'lucide-react';
import { useAuthContext } from '../Auth/AuthProvider';

export function SettingsPage() {
  const { settings, updateSettings, user } = useAuthContext();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [lighterAccountIndex, setLighterAccountIndex] = useState('');
  const [lighterAuthToken, setLighterAuthToken] = useState('');
  const [startingCapital, setStartingCapital] = useState('10000');

  // Load settings into form
  useEffect(() => {
    if (settings) {
      setLighterAccountIndex(settings.lighter_account_index?.toString() || '');
      setLighterAuthToken(settings.lighter_auth_token || '');
      setStartingCapital(settings.starting_capital?.toString() || '10000');
    }
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const { error } = await updateSettings({
        lighter_account_index: lighterAccountIndex ? parseInt(lighterAccountIndex, 10) : null,
        lighter_auth_token: lighterAuthToken || null,
        starting_capital: parseFloat(startingCapital) || 10000,
      });

      if (error) {
        setMessage({ type: 'error', text: error.message });
      } else {
        setMessage({ type: 'success', text: 'Settings saved successfully!' });
        setTimeout(() => setMessage(null), 3000);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <Settings size={28} />
        <h2>Settings</h2>
      </div>

      {user && (
        <div className="user-info">
          <span>Logged in as: <strong>{user.email}</strong></span>
        </div>
      )}

      {message && (
        <div className={`settings-message ${message.type}`}>
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="settings-form">
        {/* Lighter DEX Credentials Section */}
        <div className="settings-section">
          <div className="section-header">
            <Key size={20} />
            <h3>Lighter DEX Credentials</h3>
          </div>
          <p className="section-description">
            Connect your Lighter DEX account to sync your trading data.
          </p>

          <div className="form-group">
            <label htmlFor="accountIndex">
              Account Index
              <span className="help-tooltip" title="Your Lighter DEX account index number">
                <HelpCircle size={14} />
              </span>
            </label>
            <input
              type="number"
              id="accountIndex"
              value={lighterAccountIndex}
              onChange={(e) => setLighterAccountIndex(e.target.value)}
              placeholder="e.g., 132275"
            />
          </div>

          <div className="form-group">
            <label htmlFor="authToken">
              Auth Token
              <span className="help-tooltip" title="Your Lighter API authentication token">
                <HelpCircle size={14} />
              </span>
            </label>
            <input
              type="password"
              id="authToken"
              value={lighterAuthToken}
              onChange={(e) => setLighterAuthToken(e.target.value)}
              placeholder="Enter your auth token"
            />
            <p className="input-hint">
              Your auth token is stored securely and used to fetch your trade data.
            </p>
          </div>
        </div>

        {/* Trading Settings Section */}
        <div className="settings-section">
          <div className="section-header">
            <DollarSign size={20} />
            <h3>Trading Settings</h3>
          </div>

          <div className="form-group">
            <label htmlFor="startingCapital">
              Starting Capital (USD)
              <span className="help-tooltip" title="Your initial trading capital for calculating returns">
                <HelpCircle size={14} />
              </span>
            </label>
            <input
              type="number"
              id="startingCapital"
              value={startingCapital}
              onChange={(e) => setStartingCapital(e.target.value)}
              placeholder="10000"
              min="0"
              step="100"
            />
            <p className="input-hint">
              Used to calculate percentage returns and projections.
            </p>
          </div>
        </div>

        <div className="settings-actions">
          <button type="submit" className="save-button" disabled={saving}>
            {saving ? (
              <>
                <Loader2 size={18} className="spinning" />
                Saving...
              </>
            ) : (
              <>
                <Save size={18} />
                Save Settings
              </>
            )}
          </button>
        </div>
      </form>

      <style>{`
        .settings-page {
          max-width: 600px;
          margin: 0 auto;
        }

        .settings-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }

        .settings-header h2 {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        .settings-header svg {
          color: var(--accent);
        }

        .user-info {
          background: var(--bg-tertiary);
          padding: 0.75rem 1rem;
          border-radius: 10px;
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
          color: var(--text-secondary);
        }

        .user-info strong {
          color: var(--text-primary);
        }

        .settings-message {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          border-radius: 10px;
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
        }

        .settings-message.success {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
          color: var(--success);
        }

        .settings-message.error {
          background: rgba(220, 38, 38, 0.1);
          border: 1px solid rgba(220, 38, 38, 0.2);
          color: var(--danger);
        }

        .settings-form {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .settings-section {
          background: var(--bg-secondary);
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow:
            4px 4px 8px var(--shadow-dark),
            -4px -4px 8px var(--shadow-light);
        }

        .section-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .section-header svg {
          color: var(--accent);
        }

        .section-header h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0;
        }

        .section-description {
          font-size: 0.85rem;
          color: var(--text-muted);
          margin: 0 0 1.25rem 0;
        }

        .form-group {
          margin-bottom: 1rem;
        }

        .form-group:last-child {
          margin-bottom: 0;
        }

        .form-group label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 0.5rem;
        }

        .help-tooltip {
          color: var(--text-muted);
          cursor: help;
        }

        .help-tooltip:hover {
          color: var(--accent);
        }

        .form-group input {
          width: 100%;
          padding: 0.75rem 1rem;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--bg-tertiary);
          color: var(--text-primary);
          font-family: 'Gilroy-Medium', sans-serif;
          font-size: 0.95rem;
          transition: all 0.2s;
        }

        .form-group input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(91, 141, 239, 0.1);
        }

        .form-group input::placeholder {
          color: var(--text-muted);
        }

        .input-hint {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin: 0.5rem 0 0 0;
        }

        .settings-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 0.5rem;
        }

        .save-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.875rem 1.5rem;
          background: linear-gradient(135deg, var(--accent) 0%, #4f46e5 100%);
          color: white;
          border: none;
          border-radius: 12px;
          font-family: 'Gilroy-SemiBold', sans-serif;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .save-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(91, 141, 239, 0.4);
        }

        .save-button:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .save-button .spinning {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
