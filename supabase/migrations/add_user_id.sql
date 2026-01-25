-- Migration: Add user_id to existing tables
-- This migrates existing tables from account_index-based to user_id-based access
-- Run this in Supabase SQL Editor AFTER creating a user account

-- ============================================
-- STEP 1: Add user_id columns to existing tables
-- ============================================

-- Add user_id to position_annotations
ALTER TABLE position_annotations
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to daily_journals
ALTER TABLE daily_journals
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to weekly_journals
ALTER TABLE weekly_journals
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- ============================================
-- STEP 2: Create indexes for user_id columns
-- ============================================

CREATE INDEX IF NOT EXISTS idx_position_annotations_user_id ON position_annotations(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_journals_user_id ON daily_journals(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_journals_user_id ON weekly_journals(user_id);

-- ============================================
-- STEP 3: Update RLS policies
-- ============================================

-- Position Annotations: Update policy to use user_id
DROP POLICY IF EXISTS "Allow all operations" ON position_annotations;
DROP POLICY IF EXISTS "Users can only access own annotations" ON position_annotations;
CREATE POLICY "Users can only access own annotations" ON position_annotations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Daily Journals: Update policy to use user_id
DROP POLICY IF EXISTS "Allow all operations" ON daily_journals;
DROP POLICY IF EXISTS "Users can only access own daily journals" ON daily_journals;
CREATE POLICY "Users can only access own daily journals" ON daily_journals
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Weekly Journals: Update policy to use user_id
DROP POLICY IF EXISTS "Allow all operations" ON weekly_journals;
DROP POLICY IF EXISTS "Users can only access own weekly journals" ON weekly_journals;
CREATE POLICY "Users can only access own weekly journals" ON weekly_journals
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- STEP 4: Revoke anon access, grant only to authenticated
-- ============================================

REVOKE ALL ON position_annotations FROM anon;
REVOKE ALL ON daily_journals FROM anon;
REVOKE ALL ON weekly_journals FROM anon;

GRANT ALL ON position_annotations TO authenticated;
GRANT ALL ON daily_journals TO authenticated;
GRANT ALL ON weekly_journals TO authenticated;

-- ============================================
-- STEP 5: Migration helper function
-- Run this to assign existing data to a user
-- ============================================

-- Function to migrate existing data to a specific user
-- Usage: SELECT migrate_existing_data_to_user('your-user-uuid-here');
CREATE OR REPLACE FUNCTION migrate_existing_data_to_user(target_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  annotations_count INTEGER;
  daily_count INTEGER;
  weekly_count INTEGER;
BEGIN
  -- Update position_annotations
  UPDATE position_annotations
  SET user_id = target_user_id
  WHERE user_id IS NULL;
  GET DIAGNOSTICS annotations_count = ROW_COUNT;

  -- Update daily_journals
  UPDATE daily_journals
  SET user_id = target_user_id
  WHERE user_id IS NULL;
  GET DIAGNOSTICS daily_count = ROW_COUNT;

  -- Update weekly_journals
  UPDATE weekly_journals
  SET user_id = target_user_id
  WHERE user_id IS NULL;
  GET DIAGNOSTICS weekly_count = ROW_COUNT;

  RETURN format('Migrated: %s annotations, %s daily journals, %s weekly journals',
    annotations_count, daily_count, weekly_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
