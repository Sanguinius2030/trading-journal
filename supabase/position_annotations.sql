-- Position Annotations Table
-- Run this in Supabase SQL Editor

-- Drop old table if it exists (be careful if you have data!)
-- DROP TABLE IF EXISTS trade_annotations;

-- Create position_annotations table
CREATE TABLE IF NOT EXISTS position_annotations (
  id SERIAL PRIMARY KEY,
  position_id VARCHAR(100) NOT NULL,
  account_index INTEGER NOT NULL DEFAULT 132275,

  -- Classification
  category VARCHAR(50),           -- trend, range, breakout, reversal, event
  subcategory VARCHAR(200),       -- e.g., "Monday Range", "Sunday Pump Fade"
  timeframe VARCHAR(50),          -- scalp, intraday, swing

  -- Journal fields
  setup_thesis TEXT,              -- Why did I take this trade?
  did_well TEXT,                  -- What did I do well?
  could_improve TEXT,             -- What could I have done better?
  emotions VARCHAR(200),          -- Calm, Rushed, Revenge, FOMO, etc.
  other_notes TEXT,               -- Additional notes

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unique constraint
  UNIQUE(position_id, account_index)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_position_annotations_position_id ON position_annotations(position_id);
CREATE INDEX IF NOT EXISTS idx_position_annotations_account_index ON position_annotations(account_index);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE position_annotations ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations for now (adjust for your auth setup)
CREATE POLICY "Allow all operations" ON position_annotations
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant access to anon and authenticated users
GRANT ALL ON position_annotations TO anon;
GRANT ALL ON position_annotations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE position_annotations_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE position_annotations_id_seq TO authenticated;
