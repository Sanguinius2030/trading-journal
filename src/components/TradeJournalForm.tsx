import { useState } from 'react';
import type { Trade, TradeType, TradeStatus } from '../types';
import { PlusCircle } from 'lucide-react';

interface TradeJournalFormProps {
  onAddTrade: (trade: Trade) => void;
}

export const TradeJournalForm = ({ onAddTrade }: TradeJournalFormProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    symbol: '',
    type: 'long' as TradeType,
    status: 'open' as TradeStatus,
    entryPrice: '',
    exitPrice: '',
    quantity: '',
    entryDate: new Date().toISOString().split('T')[0],
    exitDate: '',
    notes: '',
    reasoning: '',
    tradeCategory: '',
    exchange: 'Hyperliquid' as 'Hyperliquid' | 'Lighter'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const entryPrice = parseFloat(formData.entryPrice);
    const quantity = parseFloat(formData.quantity);
    const exitPrice = formData.exitPrice ? parseFloat(formData.exitPrice) : undefined;

    let pnl: number | undefined;
    let pnlPercent: number | undefined;

    if (formData.status === 'closed' && exitPrice) {
      if (formData.type === 'long') {
        pnl = (exitPrice - entryPrice) * quantity;
        pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
      } else {
        pnl = (entryPrice - exitPrice) * quantity;
        pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
      }
    }

    const newTrade: Trade = {
      id: Date.now().toString(),
      symbol: formData.symbol,
      type: formData.type,
      status: formData.status,
      entryPrice,
      exitPrice,
      quantity,
      entryDate: new Date(formData.entryDate),
      exitDate: formData.exitDate ? new Date(formData.exitDate) : undefined,
      pnl,
      pnlPercent,
      notes: formData.notes || undefined,
      reasoning: formData.reasoning || undefined,
      tradeCategory: formData.tradeCategory || undefined,
      exchange: formData.exchange
    };

    onAddTrade(newTrade);
    setIsOpen(false);

    // Reset form
    setFormData({
      symbol: '',
      type: 'long',
      status: 'open',
      entryPrice: '',
      exitPrice: '',
      quantity: '',
      entryDate: new Date().toISOString().split('T')[0],
      exitDate: '',
      notes: '',
      reasoning: '',
      tradeCategory: '',
      exchange: 'Hyperliquid'
    });
  };

  return (
    <div className="trade-journal-form">
      {!isOpen ? (
        <button className="add-trade-button" onClick={() => setIsOpen(true)}>
          <PlusCircle size={20} />
          Add New Trade
        </button>
      ) : (
        <div className="form-container">
          <h3>Add New Trade</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Symbol *</label>
                <input
                  type="text"
                  value={formData.symbol}
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                  placeholder="ETH/USD"
                  required
                />
              </div>

              <div className="form-group">
                <label>Type *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as TradeType })}
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </div>

              <div className="form-group">
                <label>Status *</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as TradeStatus })}
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              <div className="form-group">
                <label>Exchange *</label>
                <select
                  value={formData.exchange}
                  onChange={(e) => setFormData({ ...formData, exchange: e.target.value as 'Hyperliquid' | 'Lighter' })}
                >
                  <option value="Hyperliquid">Hyperliquid</option>
                  <option value="Lighter">Lighter</option>
                </select>
              </div>

              <div className="form-group">
                <label>Entry Price *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.entryPrice}
                  onChange={(e) => setFormData({ ...formData, entryPrice: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="form-group">
                <label>Quantity *</label>
                <input
                  type="number"
                  step="0.0001"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="form-group">
                <label>Entry Date *</label>
                <input
                  type="date"
                  value={formData.entryDate}
                  onChange={(e) => setFormData({ ...formData, entryDate: e.target.value })}
                  required
                />
              </div>

              {formData.status === 'closed' && (
                <>
                  <div className="form-group">
                    <label>Exit Price *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.exitPrice}
                      onChange={(e) => setFormData({ ...formData, exitPrice: e.target.value })}
                      placeholder="0.00"
                      required={formData.status === 'closed'}
                    />
                  </div>

                  <div className="form-group">
                    <label>Exit Date *</label>
                    <input
                      type="date"
                      value={formData.exitDate}
                      onChange={(e) => setFormData({ ...formData, exitDate: e.target.value })}
                      required={formData.status === 'closed'}
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label>Trade Category</label>
                <input
                  type="text"
                  value={formData.tradeCategory}
                  onChange={(e) => setFormData({ ...formData, tradeCategory: e.target.value })}
                  placeholder="Breakout, Momentum, etc."
                />
              </div>

              <div className="form-group full-width">
                <label>Reasoning</label>
                <textarea
                  value={formData.reasoning}
                  onChange={(e) => setFormData({ ...formData, reasoning: e.target.value })}
                  placeholder="Why did you enter this trade?"
                  rows={3}
                />
              </div>

              <div className="form-group full-width">
                <label>Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Additional notes, reflections, lessons learned..."
                  rows={3}
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="cancel-button" onClick={() => setIsOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="submit-button">
                Add Trade
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
