import { useState } from 'react';
import type { Position, Trade } from '../types';
import { TrendingUp, TrendingDown, ChevronDown, ChevronRight, Save, X } from 'lucide-react';
import { format } from 'date-fns';

interface PositionsTableProps {
  positions: Position[];
  onUpdatePosition: (positionId: string, updates: { journal?: string; category?: string }) => Promise<void>;
}

const CATEGORY_OPTIONS = [
  'Breakout',
  'Momentum',
  'Trend Following',
  'Mean Reversion',
  'Scalp',
  'Swing',
  'News/Catalyst',
  'Technical',
  'Other'
];

export const PositionsTable = ({ positions, onUpdatePosition }: PositionsTableProps) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ journal: string; category: string }>({ journal: '', category: '' });
  const [saving, setSaving] = useState(false);

  const toggleRow = (positionId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(positionId)) {
      newExpanded.delete(positionId);
    } else {
      newExpanded.add(positionId);
    }
    setExpandedRows(newExpanded);
  };

  const startEditing = (position: Position) => {
    setEditingId(position.id);
    setEditValues({
      journal: position.journal || '',
      category: position.category || ''
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditValues({ journal: '', category: '' });
  };

  const saveEdits = async (positionId: string) => {
    setSaving(true);
    try {
      await onUpdatePosition(positionId, {
        journal: editValues.journal || undefined,
        category: editValues.category || undefined
      });
      setEditingId(null);
    } catch (error) {
      console.error('Failed to save position:', error);
    } finally {
      setSaving(false);
    }
  };

  const formatPrice = (price: number | undefined): string => {
    if (price === undefined || price === null) return '-';
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  };

  const formatPnl = (pnl: number | undefined): string => {
    if (pnl === undefined || pnl === null) return '-';
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}$${pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPercent = (percent: number | undefined): string => {
    if (percent === undefined || percent === null) return '-';
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
  };

  return (
    <div className="positions-table-container">
      <h2>Positions</h2>

      <div className="table-wrapper">
        <table className="positions-table">
          <thead>
            <tr>
              <th></th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Status</th>
              <th>Qty</th>
              <th>Avg Entry</th>
              <th>Avg Exit</th>
              <th>Realized P&L</th>
              <th>P&L %</th>
              <th>Journal</th>
              <th>Category</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => {
              const isExpanded = expandedRows.has(position.id);
              const isEditing = editingId === position.id;

              return (
                <>
                  <tr key={position.id} className={`position-row ${position.status}`}>
                    <td className="expand-cell" onClick={() => toggleRow(position.id)}>
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                    <td className="symbol-cell">
                      <div className="symbol-wrapper">
                        {position.side === 'LONG' ? (
                          <TrendingUp size={16} className="icon-long" />
                        ) : (
                          <TrendingDown size={16} className="icon-short" />
                        )}
                        <span className="symbol-text">{position.symbol}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`side-badge ${position.side.toLowerCase()}`}>
                        {position.side}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${position.status}`}>
                        {position.status}
                      </span>
                    </td>
                    <td className="quantity-cell">{position.totalQuantity.toFixed(4)}</td>
                    <td className="price-cell">{formatPrice(position.avgEntryPrice)}</td>
                    <td className="price-cell">{formatPrice(position.avgExitPrice)}</td>
                    <td className={`pnl-cell ${position.realizedPnl !== undefined ? (position.realizedPnl >= 0 ? 'positive' : 'negative') : ''}`}>
                      {formatPnl(position.realizedPnl)}
                    </td>
                    <td className={`pnl-cell ${position.realizedPnlPercent !== undefined ? (position.realizedPnlPercent >= 0 ? 'positive' : 'negative') : ''}`}>
                      {formatPercent(position.realizedPnlPercent)}
                    </td>
                    <td className="journal-cell">
                      {isEditing ? (
                        <textarea
                          className="edit-textarea"
                          value={editValues.journal}
                          onChange={(e) => setEditValues({ ...editValues, journal: e.target.value })}
                          placeholder="Add journal notes..."
                          rows={2}
                        />
                      ) : (
                        <span className="journal-preview" onClick={() => startEditing(position)}>
                          {position.journal || <span className="placeholder">Click to add...</span>}
                        </span>
                      )}
                    </td>
                    <td className="category-cell">
                      {isEditing ? (
                        <select
                          className="edit-select"
                          value={editValues.category}
                          onChange={(e) => setEditValues({ ...editValues, category: e.target.value })}
                        >
                          <option value="">Select category...</option>
                          {CATEGORY_OPTIONS.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`category-badge ${position.category ? '' : 'empty'}`}
                          onClick={() => startEditing(position)}
                        >
                          {position.category || 'Set category'}
                        </span>
                      )}
                    </td>
                    <td className="actions-cell">
                      {isEditing ? (
                        <div className="action-buttons">
                          <button
                            className="save-btn"
                            onClick={() => saveEdits(position.id)}
                            disabled={saving}
                          >
                            <Save size={14} />
                          </button>
                          <button
                            className="cancel-btn"
                            onClick={cancelEditing}
                            disabled={saving}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button className="edit-btn" onClick={() => startEditing(position)}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* Expanded row showing fills */}
                  {isExpanded && position.fills && position.fills.length > 0 && (
                    <tr className="fills-row">
                      <td colSpan={12}>
                        <div className="fills-container">
                          <h4>Fills ({position.fillsCount})</h4>
                          <table className="fills-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Side</th>
                                <th>Price</th>
                                <th>Quantity</th>
                              </tr>
                            </thead>
                            <tbody>
                              {position.fills.map((fill: Trade) => (
                                <tr key={fill.id}>
                                  <td>{format(new Date(fill.entryDate), 'MMM dd, yyyy HH:mm')}</td>
                                  <td>
                                    <span className={`side-badge ${fill.type}`}>
                                      {fill.type === 'long' ? 'BUY' : 'SELL'}
                                    </span>
                                  </td>
                                  <td>{formatPrice(fill.entryPrice)}</td>
                                  <td>{fill.quantity}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {positions.length === 0 && (
        <div className="no-positions">
          <p>No positions found. Trades will be aggregated into positions automatically.</p>
        </div>
      )}
    </div>
  );
};
