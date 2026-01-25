-- Positions Table
-- Stores aggregated position data (calculated from trades)
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  position_id VARCHAR(100) NOT NULL,
  market_symbol VARCHAR(20),
  position_type VARCHAR(10), -- 'LONG' or 'SHORT'
  entry_time BIGINT, -- Unix timestamp in milliseconds
  exit_time BIGINT, -- Unix timestamp in milliseconds (null if open)
  entry_date VARCHAR(30), -- Formatted: "DD/MM/YYYY HH:mm:ss"
  exit_date VARCHAR(30), -- Formatted: "DD/MM/YYYY HH:mm:ss" (null if open)
  avg_entry_price DECIMAL(20, 8),
  avg_exit_price DECIMAL(20, 8),
  total_entry_value DECIMAL(20, 8),
  total_exit_value DECIMAL(20, 8),
  total_size DECIMAL(20, 8),
  pnl DECIMAL(20, 8),
  total_fees DECIMAL(20, 8),
  is_closed BOOLEAN DEFAULT false,
  trade_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure unique positions per user
  UNIQUE(user_id, position_id)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_entry_time ON positions(entry_time);
CREATE INDEX IF NOT EXISTS idx_positions_is_closed ON positions(is_closed);
CREATE INDEX IF NOT EXISTS idx_positions_market_symbol ON positions(market_symbol);

-- Enable Row Level Security
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own positions
DROP POLICY IF EXISTS "Users can only access own positions" ON positions;
CREATE POLICY "Users can only access own positions" ON positions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Grant access to authenticated users only
GRANT ALL ON positions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE positions_id_seq TO authenticated;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_positions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS positions_updated_at ON positions;
CREATE TRIGGER positions_updated_at
  BEFORE UPDATE ON positions
  FOR EACH ROW
  EXECUTE FUNCTION update_positions_updated_at();
