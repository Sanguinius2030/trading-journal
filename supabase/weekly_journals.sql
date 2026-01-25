-- Weekly Journals Table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS weekly_journals (
  id SERIAL PRIMARY KEY,
  week_start VARCHAR(10) NOT NULL,        -- DD/MM/YYYY format (Monday of the week)
  week_end VARCHAR(10) NOT NULL,          -- DD/MM/YYYY format (Sunday of the week)
  account_index INTEGER NOT NULL DEFAULT 132275,

  -- Journal fields
  weekly_goals TEXT,                       -- What were my goals for this week?
  market_overview TEXT,                    -- Overall market conditions this week
  performance_review TEXT,                 -- How did I perform this week?
  biggest_wins TEXT,                       -- What were my biggest wins?
  biggest_lessons TEXT,                    -- What were my biggest lessons?
  areas_to_improve TEXT,                   -- What do I need to work on?
  next_week_focus TEXT,                    -- What will I focus on next week?
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),  -- Week rating 1-5 stars

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unique constraint
  UNIQUE(week_start, account_index)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_weekly_journals_week_start ON weekly_journals(week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_journals_account_index ON weekly_journals(account_index);

-- Enable Row Level Security
ALTER TABLE weekly_journals ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust for your auth setup)
CREATE POLICY "Allow all operations" ON weekly_journals
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant access to anon and authenticated users
GRANT ALL ON weekly_journals TO anon;
GRANT ALL ON weekly_journals TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE weekly_journals_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE weekly_journals_id_seq TO authenticated;
