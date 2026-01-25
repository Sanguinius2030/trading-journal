-- Trades Table
-- Stores raw trade data from Lighter DEX API
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  trade_id VARCHAR(100) NOT NULL,
  market_id INTEGER,
  market_symbol VARCHAR(20),
  side VARCHAR(10), -- 'BUY' or 'SELL'
  size DECIMAL(20, 8),
  price DECIMAL(20, 8),
  fee DECIMAL(20, 8),
  realized_pnl DECIMAL(20, 8),
  is_maker BOOLEAN DEFAULT false,
  timestamp BIGINT, -- Unix timestamp in milliseconds
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure unique trades per user
  UNIQUE(user_id, trade_id)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_trades_market_symbol ON trades(market_symbol);

-- Enable Row Level Security
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own trades
DROP POLICY IF EXISTS "Users can only access own trades" ON trades;
CREATE POLICY "Users can only access own trades" ON trades
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Grant access to authenticated users only
GRANT ALL ON trades TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE trades_id_seq TO authenticated;
