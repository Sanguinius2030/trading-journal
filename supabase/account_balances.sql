-- Account Balances Table
-- Stores current account balance snapshot per user
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS account_balances (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  account_equity DECIMAL(20, 8),
  available_balance DECIMAL(20, 8),
  unrealized_pnl DECIMAL(20, 8),
  margin_used DECIMAL(20, 8),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One balance record per user
  UNIQUE(user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_account_balances_user_id ON account_balances(user_id);

-- Enable Row Level Security
ALTER TABLE account_balances ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own balance
DROP POLICY IF EXISTS "Users can only access own balance" ON account_balances;
CREATE POLICY "Users can only access own balance" ON account_balances
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Grant access to authenticated users only
GRANT ALL ON account_balances TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE account_balances_id_seq TO authenticated;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_account_balances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS account_balances_updated_at ON account_balances;
CREATE TRIGGER account_balances_updated_at
  BEFORE UPDATE ON account_balances
  FOR EACH ROW
  EXECUTE FUNCTION update_account_balances_updated_at();
