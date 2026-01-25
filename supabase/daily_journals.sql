-- Daily Journals Table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS daily_journals (
  id SERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL,           -- DD/MM/YYYY format (matches existing dateKey)
  account_index INTEGER NOT NULL DEFAULT 132275,

  -- Journal fields
  market_context TEXT,                  -- What was happening in the market today?
  daily_plan TEXT,                      -- What was my plan for the day?
  execution_review TEXT,                -- How well did I execute my plan?
  key_lessons TEXT,                     -- What did I learn today?
  emotions_summary VARCHAR(200),        -- Overall emotional state
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),  -- Day rating 1-5 stars

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unique constraint
  UNIQUE(date, account_index)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_daily_journals_date ON daily_journals(date);
CREATE INDEX IF NOT EXISTS idx_daily_journals_account_index ON daily_journals(account_index);

-- Enable Row Level Security
ALTER TABLE daily_journals ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust for your auth setup)
CREATE POLICY "Allow all operations" ON daily_journals
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant access to anon and authenticated users
GRANT ALL ON daily_journals TO anon;
GRANT ALL ON daily_journals TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE daily_journals_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE daily_journals_id_seq TO authenticated;
