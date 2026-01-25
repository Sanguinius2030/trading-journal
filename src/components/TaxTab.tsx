import { useState, useEffect, useMemo, useRef } from 'react';
import { FileText, Download, Calculator, AlertTriangle, CheckCircle, Euro, RefreshCw } from 'lucide-react';

interface AggregatedPosition {
  position_id: string;
  market_symbol: string;
  entry_time: number;
  exit_time: number | null;
  entry_date: string; // Format: "DD/MM/YYYY HH:mm:ss"
  exit_date: string | null; // Format: "DD/MM/YYYY HH:mm:ss"
  avg_entry_price: number;
  avg_exit_price: number | null;
  total_entry_value: number;
  total_exit_value: number;
  pnl: number | null;
  position_type: 'LONG' | 'SHORT';
  is_closed: boolean;
}

interface TaxablePosition {
  position_id: string;
  market_symbol: string;
  entry_date_display: string;
  exit_date_display: string;
  exit_date_iso: string; // For API: YYYY-MM-DD
  pnl_usd: number;
  pnl_eur: number;
  eur_usd_rate: number;
  position_type: 'LONG' | 'SHORT';
  is_gain: boolean;
  tax_relevant_pnl: number;
}

interface ExchangeRateCache {
  [date: string]: number;
}

// German tax constants
const TAX_FREE_ALLOWANCE = 600; // €600 Freigrenze

// Cache for exchange rates
const RATE_CACHE_KEY = 'eur-usd-rates-cache';

// Parse date string "DD/MM/YYYY HH:mm:ss" to components
function parseDateString(dateStr: string): { day: number; month: number; year: number; isoDate: string } | null {
  if (!dateStr) return null;

  const datePart = dateStr.split(' ')[0]; // "DD/MM/YYYY"
  const parts = datePart.split('/');
  if (parts.length !== 3) return null;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

  // ISO format for API: YYYY-MM-DD
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { day, month, year, isoDate };
}

export function TaxTab() {
  const [positions, setPositions] = useState<AggregatedPosition[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(2025);
  const [loading, setLoading] = useState(true);
  const [loadingRates, setLoadingRates] = useState(false);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateCache>({});
  const [ratesError, setRatesError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  // Load positions
  useEffect(() => {
    const loadPositions = async () => {
      try {
        const response = await fetch('/aggregated-positions.json');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('Tax Tab - Loaded positions:', data.positions?.length || 0);
        setPositions(data.positions || []);
      } catch (error) {
        console.error('Failed to load positions:', error);
      } finally {
        setLoading(false);
      }
    };
    loadPositions();

    // Load cached exchange rates
    const cached = localStorage.getItem(RATE_CACHE_KEY);
    if (cached) {
      try {
        setExchangeRates(JSON.parse(cached));
      } catch (e) {
        console.error('Failed to parse cached rates:', e);
      }
    }
  }, []);

  // Get available years from positions using date strings
  const availableYears = useMemo(() => {
    const years = new Set<number>();

    positions.forEach(pos => {
      if (pos.is_closed && pos.exit_date) {
        const parsed = parseDateString(pos.exit_date);
        if (parsed) {
          years.add(parsed.year);
        }
      }
    });

    // Always include current year and 2025
    const currentYear = new Date().getFullYear();
    years.add(currentYear);
    years.add(2025);

    return Array.from(years).sort((a, b) => b - a);
  }, [positions]);

  // Set initial year based on available data
  useEffect(() => {
    if (positions.length > 0) {
      const yearsWithData: number[] = [];
      positions.forEach(pos => {
        if (pos.is_closed && pos.exit_date) {
          const parsed = parseDateString(pos.exit_date);
          if (parsed) {
            yearsWithData.push(parsed.year);
          }
        }
      });

      if (yearsWithData.length > 0) {
        const mostRecentYear = Math.max(...yearsWithData);
        setSelectedYear(mostRecentYear);
      }
    }
  }, [positions]);

  // Get unique exit dates for the selected year that need exchange rates
  const exitDatesNeeded = useMemo(() => {
    const dates = new Set<string>();

    positions.forEach(pos => {
      if (pos.is_closed && pos.pnl !== null && pos.exit_date) {
        const parsed = parseDateString(pos.exit_date);
        if (parsed && parsed.year === selectedYear) {
          dates.add(parsed.isoDate);
        }
      }
    });

    return Array.from(dates).sort();
  }, [positions, selectedYear]);

  // Fetch missing exchange rates
  const fetchExchangeRates = async () => {
    const missingDates = exitDatesNeeded.filter(date => !exchangeRates[date]);

    if (missingDates.length === 0) {
      return;
    }

    setLoadingRates(true);
    setRatesError(null);

    const newRates: ExchangeRateCache = { ...exchangeRates };
    const today = new Date().toISOString().split('T')[0];

    try {
      for (const date of missingDates) {
        try {
          // Skip future dates
          if (date > today) {
            newRates[date] = 0.92;
            continue;
          }

          const response = await fetch(`https://api.frankfurter.app/${date}?from=USD&to=EUR`);
          if (response.ok) {
            const data = await response.json();
            if (data.rates && data.rates.EUR) {
              newRates[date] = data.rates.EUR;
              console.log(`Fetched rate for ${date}: ${data.rates.EUR}`);
            }
          } else {
            // Weekend/holiday - try previous day
            const prevDate = new Date(date);
            prevDate.setDate(prevDate.getDate() - 1);
            const prevDateStr = prevDate.toISOString().split('T')[0];

            if (newRates[prevDateStr]) {
              newRates[date] = newRates[prevDateStr];
            } else {
              const latestResponse = await fetch(`https://api.frankfurter.app/${prevDateStr}?from=USD&to=EUR`);
              if (latestResponse.ok) {
                const latestData = await latestResponse.json();
                if (latestData.rates && latestData.rates.EUR) {
                  newRates[date] = latestData.rates.EUR;
                }
              } else {
                newRates[date] = 0.92; // Fallback
              }
            }
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.error(`Failed to fetch rate for ${date}:`, err);
          newRates[date] = 0.92;
        }
      }

      setExchangeRates(newRates);
      localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(newRates));
    } catch (error) {
      console.error('Failed to fetch exchange rates:', error);
      setRatesError('Einige Wechselkurse konnten nicht geladen werden. Fallback-Kurs von 0.92 EUR/USD wird verwendet.');
    } finally {
      setLoadingRates(false);
    }
  };

  // Auto-fetch rates when year changes
  useEffect(() => {
    if (exitDatesNeeded.length > 0 && !loading) {
      const missingDates = exitDatesNeeded.filter(date => !exchangeRates[date]);
      if (missingDates.length > 0) {
        fetchExchangeRates();
      }
    }
  }, [exitDatesNeeded, loading]);

  // Calculate taxable positions for selected year
  const taxablePositions = useMemo((): TaxablePosition[] => {
    return positions
      .filter(pos => {
        if (!pos.is_closed || pos.pnl === null || !pos.exit_date) return false;
        const parsed = parseDateString(pos.exit_date);
        return parsed && parsed.year === selectedYear;
      })
      .map(pos => {
        const exitParsed = parseDateString(pos.exit_date!);
        const entryParsed = parseDateString(pos.entry_date);

        const exitDateIso = exitParsed?.isoDate || '';
        const eurUsdRate = exchangeRates[exitDateIso] || 0.92;
        const pnlEur = (pos.pnl || 0) * eurUsdRate;

        // Format dates for display: DD.MM.YYYY
        const entryDisplay = entryParsed
          ? `${String(entryParsed.day).padStart(2, '0')}.${String(entryParsed.month).padStart(2, '0')}.${entryParsed.year}`
          : pos.entry_date.split(' ')[0].replace(/\//g, '.');

        const exitDisplay = exitParsed
          ? `${String(exitParsed.day).padStart(2, '0')}.${String(exitParsed.month).padStart(2, '0')}.${exitParsed.year}`
          : pos.exit_date!.split(' ')[0].replace(/\//g, '.');

        return {
          position_id: pos.position_id,
          market_symbol: pos.market_symbol,
          entry_date_display: entryDisplay,
          exit_date_display: exitDisplay,
          exit_date_iso: exitDateIso,
          pnl_usd: pos.pnl || 0,
          pnl_eur: pnlEur,
          eur_usd_rate: eurUsdRate,
          position_type: pos.position_type,
          is_gain: pnlEur > 0,
          tax_relevant_pnl: 0
        };
      })
      .sort((a, b) => a.exit_date_iso.localeCompare(b.exit_date_iso));
  }, [positions, selectedYear, exchangeRates]);

  // Calculate tax summary with loss offsetting
  const taxSummary = useMemo(() => {
    const gains = taxablePositions
      .filter(p => p.pnl_eur > 0)
      .reduce((sum, p) => sum + p.pnl_eur, 0);

    const losses = taxablePositions
      .filter(p => p.pnl_eur < 0)
      .reduce((sum, p) => sum + Math.abs(p.pnl_eur), 0);

    // Net P&L after loss offsetting
    const netPnl = gains - losses;

    // Only positive net gains are potentially taxable
    const potentiallyTaxableGain = Math.max(0, netPnl);

    // Check if under €600 Freigrenze
    const isUnderAllowance = potentiallyTaxableGain <= TAX_FREE_ALLOWANCE;
    const taxableAmount = isUnderAllowance ? 0 : potentiallyTaxableGain;

    // Calculate which gains were offset by losses
    let remainingLosses = losses;
    const positionsWithTaxStatus = taxablePositions.map(p => {
      if (p.pnl_eur <= 0) {
        return { ...p, tax_relevant_pnl: p.pnl_eur, status: 'loss' as const };
      }

      if (remainingLosses > 0) {
        const offsetAmount = Math.min(p.pnl_eur, remainingLosses);
        remainingLosses -= offsetAmount;
        const netGain = p.pnl_eur - offsetAmount;

        if (netGain <= 0) {
          return { ...p, tax_relevant_pnl: 0, status: 'offset' as const };
        } else {
          return { ...p, tax_relevant_pnl: netGain, status: 'partial-offset' as const };
        }
      }

      return { ...p, tax_relevant_pnl: p.pnl_eur, status: 'taxable' as const };
    });

    return {
      totalPositions: taxablePositions.length,
      gains,
      losses,
      netPnl,
      potentiallyTaxableGain,
      isUnderAllowance,
      taxableAmount,
      totalPnlUsd: taxablePositions.reduce((sum, p) => sum + p.pnl_usd, 0),
      totalPnlEur: taxablePositions.reduce((sum, p) => sum + p.pnl_eur, 0),
      positionsWithTaxStatus,
      lossesUsedForOffset: losses - remainingLosses,
      winCount: taxablePositions.filter(p => p.pnl_eur > 0).length,
      lossCount: taxablePositions.filter(p => p.pnl_eur < 0).length
    };
  }, [taxablePositions]);

  const formatCurrency = (value: number, currency: 'EUR' | 'USD' = 'EUR') => {
    const symbol = currency === 'EUR' ? '€' : '$';
    const formatted = Math.abs(value).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${value < 0 ? '-' : ''}${symbol}${formatted}`;
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="tax-tab">
        <div className="tax-loading">Lade Steuerdaten...</div>
      </div>
    );
  }

  return (
    <div className="tax-tab">
      <div className="tax-header">
        <div className="tax-title">
          <FileText size={24} />
          <h2>Steuerübersicht / Tax Overview</h2>
        </div>
        <div className="tax-controls">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="year-select"
          >
            {availableYears.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          {loadingRates && (
            <span className="loading-rates">
              <RefreshCw size={16} className="spinning" />
              Lade Wechselkurse...
            </span>
          )}
          <button className="export-btn" onClick={handlePrint}>
            <Download size={18} />
            Als PDF exportieren
          </button>
        </div>
      </div>

      <div className="tax-content" ref={printRef}>
        {/* Tax Info Banner */}
        <div className="tax-info-banner">
          <AlertTriangle size={20} />
          <div>
            <strong>Hinweis zur deutschen Besteuerung von Derivaten:</strong>
            <ul>
              <li>Gewinne aus Derivaten (Perpetual Contracts) sind als sonstige Einkünfte steuerpflichtig</li>
              <li>Gewinne unter €600 pro Jahr sind steuerfrei (Freigrenze, nicht Freibetrag!)</li>
              <li><strong>Bei Überschreitung der €600 ist der GESAMTE Gewinn steuerpflichtig</strong></li>
              <li>Verluste können mit Gewinnen im selben Jahr verrechnet werden</li>
              <li>Wechselkurse werden von der EZB für jeden Handelstag abgerufen</li>
            </ul>
          </div>
        </div>

        {ratesError && (
          <div className="rates-error">
            <AlertTriangle size={16} />
            {ratesError}
          </div>
        )}

        {/* Summary Cards */}
        <div className="tax-summary-grid">
          <div className="tax-summary-card highlight">
            <div className="card-icon">
              <Calculator size={24} />
            </div>
            <div className="card-content">
              <span className="card-label">Steuerpflichtiger Betrag {selectedYear}</span>
              <span className={`card-value ${taxSummary.taxableAmount > 0 ? 'warning' : 'success'}`}>
                {formatCurrency(taxSummary.taxableAmount)}
              </span>
              {taxSummary.isUnderAllowance ? (
                <span className="card-note success">
                  <CheckCircle size={14} />
                  Unter Freigrenze (€600) - steuerfrei
                </span>
              ) : (
                <span className="card-note warning">
                  <AlertTriangle size={14} />
                  Über Freigrenze - gesamter Betrag steuerpflichtig
                </span>
              )}
            </div>
          </div>

          <div className="tax-summary-card">
            <div className="card-content">
              <span className="card-label">Gewinne</span>
              <span className="card-value positive">{formatCurrency(taxSummary.gains)}</span>
              <span className="card-note">{taxSummary.winCount} profitable Trades</span>
            </div>
          </div>

          <div className="tax-summary-card">
            <div className="card-content">
              <span className="card-label">Verluste</span>
              <span className="card-value negative">-{formatCurrency(taxSummary.losses)}</span>
              <span className="card-note">{taxSummary.lossCount} Verlusttrades</span>
            </div>
          </div>

          <div className="tax-summary-card">
            <div className="card-content">
              <span className="card-label">Netto (nach Verrechnung)</span>
              <span className={`card-value ${taxSummary.netPnl >= 0 ? 'positive' : 'negative'}`}>
                {formatCurrency(taxSummary.netPnl)}
              </span>
              <span className="card-note">
                {taxSummary.lossesUsedForOffset > 0 && `${formatCurrency(taxSummary.lossesUsedForOffset)} Verluste verrechnet`}
              </span>
            </div>
          </div>

          <div className="tax-summary-card">
            <div className="card-content">
              <span className="card-label">Gesamt P&L {selectedYear}</span>
              <span className={`card-value ${taxSummary.totalPnlEur >= 0 ? 'positive' : 'negative'}`}>
                {formatCurrency(taxSummary.totalPnlEur)}
              </span>
              <span className="card-note">{formatCurrency(taxSummary.totalPnlUsd, 'USD')}</span>
            </div>
          </div>
        </div>

        {/* Loss Offset Explanation */}
        {taxSummary.losses > 0 && taxSummary.gains > 0 && (
          <div className="offset-explanation">
            <h4>Verlustverrechnung</h4>
            <p>
              Deine Verluste von <strong>{formatCurrency(taxSummary.losses)}</strong> wurden
              mit deinen Gewinnen von <strong>{formatCurrency(taxSummary.gains)}</strong> verrechnet.
              {taxSummary.netPnl > 0 ? (
                <> Nach Verrechnung verbleibt ein Gewinn von <strong>{formatCurrency(taxSummary.netPnl)}</strong>.</>
              ) : (
                <> Die Verluste übersteigen die Gewinne - kein steuerpflichtiger Gewinn.</>
              )}
            </p>
          </div>
        )}

        {/* Detailed Transactions Table */}
        <div className="tax-transactions">
          <h3>
            <Euro size={20} />
            Transaktionen {selectedYear} ({taxSummary.totalPositions} Positionen)
          </h3>

          {taxSummary.positionsWithTaxStatus.length === 0 ? (
            <div className="no-transactions">
              Keine abgeschlossenen Positionen in {selectedYear}
              <p className="no-transactions-hint">
                Positionen werden hier angezeigt, sobald sie geschlossen wurden.
              </p>
            </div>
          ) : (
            <div className="transactions-table-wrapper">
              <table className="transactions-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Typ</th>
                    <th>Eröffnet</th>
                    <th>Geschlossen</th>
                    <th>EUR/USD</th>
                    <th>P&L (USD)</th>
                    <th>P&L (EUR)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {taxSummary.positionsWithTaxStatus.map((pos) => (
                    <tr key={pos.position_id}>
                      <td className="asset">{pos.market_symbol}</td>
                      <td>
                        <span className={`type-badge ${pos.position_type.toLowerCase()}`}>
                          {pos.position_type}
                        </span>
                      </td>
                      <td>{pos.entry_date_display}</td>
                      <td>{pos.exit_date_display}</td>
                      <td className="rate">{pos.eur_usd_rate.toFixed(4)}</td>
                      <td className={pos.pnl_usd >= 0 ? 'positive' : 'negative'}>
                        {formatCurrency(pos.pnl_usd, 'USD')}
                      </td>
                      <td className={pos.pnl_eur >= 0 ? 'positive' : 'negative'}>
                        {formatCurrency(pos.pnl_eur)}
                      </td>
                      <td>
                        {pos.status === 'loss' ? (
                          <span className="status-badge loss">Verlust</span>
                        ) : pos.status === 'offset' ? (
                          <span className="status-badge offset">Verrechnet</span>
                        ) : pos.status === 'partial-offset' ? (
                          <span className="status-badge partial">
                            Teilw. verrechnet
                            <span className="tax-relevant">({formatCurrency(pos.tax_relevant_pnl)} stpfl.)</span>
                          </span>
                        ) : (
                          <span className="status-badge taxable">Steuerpflichtig</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}><strong>Gesamt</strong></td>
                    <td className={taxSummary.totalPnlUsd >= 0 ? 'positive' : 'negative'}>
                      <strong>{formatCurrency(taxSummary.totalPnlUsd, 'USD')}</strong>
                    </td>
                    <td className={taxSummary.totalPnlEur >= 0 ? 'positive' : 'negative'}>
                      <strong>{formatCurrency(taxSummary.totalPnlEur)}</strong>
                    </td>
                    <td>
                      <strong className={taxSummary.taxableAmount > 0 ? 'warning' : 'success'}>
                        {formatCurrency(taxSummary.taxableAmount)} stpfl.
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Print Footer */}
        <div className="print-footer">
          <p>Generiert am {new Date().toLocaleDateString('de-DE')} um {new Date().toLocaleTimeString('de-DE')}</p>
          <p>Trading Journal - Steuerübersicht {selectedYear}</p>
          <p className="disclaimer">
            Diese Übersicht dient nur zu Informationszwecken und ersetzt keine professionelle Steuerberatung.
            Bitte konsultieren Sie einen Steuerberater für Ihre individuelle Steuererklärung.
          </p>
        </div>
      </div>

      <style>{`
        .tax-tab {
          padding: 0;
        }

        .tax-loading {
          text-align: center;
          padding: 4rem;
          color: var(--text-muted);
        }

        .tax-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .tax-title {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .tax-title h2 {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .tax-title svg {
          color: var(--accent);
        }

        .tax-controls {
          display: flex;
          gap: 1rem;
          align-items: center;
        }

        .loading-rates {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
          color: var(--text-muted);
        }

        .loading-rates .spinning {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .year-select {
          padding: 0.625rem 1rem;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--bg-secondary);
          color: var(--text-primary);
          font-size: 0.875rem;
          font-family: 'Gilroy-Medium', sans-serif;
          cursor: pointer;
          min-width: 100px;
        }

        .export-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.625rem 1.25rem;
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 10px;
          font-family: 'Gilroy-SemiBold', sans-serif;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .export-btn:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }

        .tax-info-banner {
          display: flex;
          gap: 1rem;
          padding: 1.25rem;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.2);
          border-radius: 12px;
          margin-bottom: 1.5rem;
          color: var(--text-primary);
        }

        .tax-info-banner svg {
          color: #3b82f6;
          flex-shrink: 0;
          margin-top: 0.25rem;
        }

        .tax-info-banner strong {
          display: block;
          margin-bottom: 0.5rem;
        }

        .tax-info-banner ul {
          margin: 0;
          padding-left: 1.25rem;
          font-size: 0.875rem;
          color: var(--text-secondary);
        }

        .tax-info-banner li {
          margin-bottom: 0.25rem;
        }

        .rates-error {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 8px;
          margin-bottom: 1.5rem;
          color: #b45309;
          font-size: 0.875rem;
        }

        .tax-summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .tax-summary-card {
          background: var(--bg-secondary);
          border-radius: 16px;
          padding: 1.25rem;
          box-shadow:
            4px 4px 8px var(--shadow-dark),
            -4px -4px 8px var(--shadow-light);
        }

        .tax-summary-card.highlight {
          grid-column: span 2;
          display: flex;
          align-items: center;
          gap: 1.5rem;
          background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
        }

        .card-icon {
          width: 60px;
          height: 60px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent);
          color: white;
          flex-shrink: 0;
        }

        .card-content {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .card-label {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 500;
        }

        .card-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        .card-value.positive { color: var(--success); }
        .card-value.negative { color: var(--danger); }
        .card-value.warning { color: #f59e0b; }
        .card-value.success { color: var(--success); }

        .card-note {
          font-size: 0.75rem;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .card-note.success { color: var(--success); }
        .card-note.warning { color: #f59e0b; }

        .offset-explanation {
          background: var(--bg-secondary);
          border-radius: 12px;
          padding: 1.25rem;
          margin-bottom: 1.5rem;
          border-left: 4px solid var(--accent);
        }

        .offset-explanation h4 {
          margin: 0 0 0.5rem 0;
          font-size: 0.9rem;
          color: var(--text-primary);
        }

        .offset-explanation p {
          margin: 0;
          font-size: 0.875rem;
          color: var(--text-secondary);
          line-height: 1.6;
        }

        .tax-transactions {
          background: var(--bg-secondary);
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow:
            4px 4px 8px var(--shadow-dark),
            -4px -4px 8px var(--shadow-light);
        }

        .tax-transactions h3 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 0 0 1.5rem 0;
          font-size: 1.125rem;
          color: var(--text-primary);
        }

        .tax-transactions h3 svg {
          color: var(--accent);
        }

        .no-transactions {
          text-align: center;
          padding: 3rem;
          color: var(--text-muted);
        }

        .no-transactions-hint {
          font-size: 0.8rem;
          margin-top: 0.5rem;
          opacity: 0.7;
        }

        .transactions-table-wrapper {
          overflow-x: auto;
        }

        .transactions-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
        }

        .transactions-table th {
          text-align: left;
          padding: 0.75rem;
          background: var(--bg-tertiary);
          color: var(--text-muted);
          font-weight: 600;
          font-size: 0.7rem;
          text-transform: uppercase;
          border-bottom: 2px solid var(--border);
          white-space: nowrap;
        }

        .transactions-table td {
          padding: 0.75rem;
          border-bottom: 1px solid var(--border);
          color: var(--text-primary);
        }

        .transactions-table tr:hover {
          background: var(--bg-tertiary);
        }

        .transactions-table .asset {
          font-weight: 600;
        }

        .transactions-table .rate {
          font-family: monospace;
          font-size: 0.8rem;
          color: var(--text-muted);
        }

        .transactions-table .positive {
          color: var(--success);
          font-weight: 600;
        }

        .transactions-table .negative {
          color: var(--danger);
          font-weight: 600;
        }

        .type-badge {
          display: inline-block;
          padding: 0.2rem 0.5rem;
          border-radius: 4px;
          font-size: 0.65rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .type-badge.long {
          background: rgba(16, 185, 129, 0.15);
          color: var(--success);
        }

        .type-badge.short {
          background: rgba(220, 38, 38, 0.15);
          color: var(--danger);
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          font-size: 0.65rem;
          font-weight: 600;
          white-space: nowrap;
        }

        .status-badge.taxable {
          background: rgba(245, 158, 11, 0.15);
          color: #f59e0b;
        }

        .status-badge.loss {
          background: rgba(220, 38, 38, 0.15);
          color: var(--danger);
        }

        .status-badge.offset {
          background: rgba(59, 130, 246, 0.15);
          color: #3b82f6;
        }

        .status-badge.partial {
          background: rgba(139, 92, 246, 0.15);
          color: #8b5cf6;
          flex-direction: column;
          align-items: flex-start;
        }

        .status-badge .tax-relevant {
          font-size: 0.6rem;
          opacity: 0.8;
        }

        .transactions-table tfoot td {
          background: var(--bg-tertiary);
          border-top: 2px solid var(--border);
          font-weight: 600;
        }

        .transactions-table tfoot .warning {
          color: #f59e0b;
        }

        .transactions-table tfoot .success {
          color: var(--success);
        }

        .print-footer {
          display: none;
          margin-top: 2rem;
          padding-top: 1rem;
          border-top: 1px solid var(--border);
          text-align: center;
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .print-footer .disclaimer {
          margin-top: 1rem;
          font-style: italic;
        }

        @media print {
          .tax-tab {
            padding: 0;
          }

          .tax-controls {
            display: none;
          }

          .tax-info-banner {
            background: #f0f7ff !important;
            border: 1px solid #3b82f6 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .tax-summary-card {
            box-shadow: none;
            border: 1px solid #e5e7eb;
          }

          .tax-transactions {
            box-shadow: none;
            border: 1px solid #e5e7eb;
          }

          .print-footer {
            display: block;
          }
        }

        @media (max-width: 768px) {
          .tax-header {
            flex-direction: column;
            align-items: flex-start;
          }

          .tax-summary-card.highlight {
            grid-column: span 1;
            flex-direction: column;
            text-align: center;
          }

          .transactions-table {
            font-size: 0.75rem;
          }

          .transactions-table th,
          .transactions-table td {
            padding: 0.5rem;
          }
        }
      `}</style>
    </div>
  );
}
