-- Migration: Restore anon access for local development
-- The add_user_id migration revoked anon access, breaking local dev.
-- This restores anon access with RLS policies that limit anon to legacy rows (user_id IS NULL).
-- Run this in Supabase SQL Editor.

-- ============================================
-- STEP 1: Re-grant anon access to tables
-- ============================================

GRANT ALL ON position_annotations TO anon;
GRANT ALL ON daily_journals TO anon;
GRANT ALL ON weekly_journals TO anon;
GRANT USAGE, SELECT ON SEQUENCE daily_journals_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE weekly_journals_id_seq TO anon;

-- ============================================
-- STEP 2: Add RLS policy for anon (legacy account_index rows)
-- ============================================

-- Anon can access rows where user_id IS NULL (legacy local dev data)
DROP POLICY IF EXISTS "Anon can access legacy annotations" ON position_annotations;
CREATE POLICY "Anon can access legacy annotations" ON position_annotations
  FOR ALL
  USING (user_id IS NULL)
  WITH CHECK (user_id IS NULL);

DROP POLICY IF EXISTS "Anon can access legacy daily journals" ON daily_journals;
CREATE POLICY "Anon can access legacy daily journals" ON daily_journals
  FOR ALL
  USING (user_id IS NULL)
  WITH CHECK (user_id IS NULL);

DROP POLICY IF EXISTS "Anon can access legacy weekly journals" ON weekly_journals;
CREATE POLICY "Anon can access legacy weekly journals" ON weekly_journals
  FOR ALL
  USING (user_id IS NULL)
  WITH CHECK (user_id IS NULL);
