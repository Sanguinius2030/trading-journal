/**
 * Sync aggregated trade sessions to Supabase
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';
const ACCOUNT_INDEX = 132275;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Supabase credentials not found in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface AggregatedSession {
  session_id: string;
  entry_time: number;
  exit_time: number | null;
  direction: 'long' | 'short';
  status: 'open' | 'closed' | 'partial';
  entry_size: number;
  avg_entry_price: number;
  entry_value: number;
  exit_size: number;
  avg_exit_price: number | null;
  exit_value: number;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  roi_percent: number | null;
  total_fees: number;
  duration_minutes: number | null;
}

async function syncSessions() {
  console.log('='.repeat(80));
  console.log('SYNCING SESSIONS TO SUPABASE');
  console.log('='.repeat(80));

  // Load aggregated sessions
  const sessions: AggregatedSession[] = JSON.parse(
    readFileSync('../data/aggregated-sessions.json', 'utf-8')
  );

  console.log(`\nLoaded ${sessions.length} sessions`);

  // Prepare data for Supabase
  const sessionsToUpsert = sessions.map(session => ({
    session_id: session.session_id,
    account_index: ACCOUNT_INDEX,
    entry_time: session.entry_time,
    exit_time: session.exit_time,
    direction: session.direction,
    status: session.status,
    entry_size: session.entry_size,
    avg_entry_price: session.avg_entry_price,
    entry_value: session.entry_value,
    exit_size: session.exit_size,
    avg_exit_price: session.avg_exit_price,
    exit_value: session.exit_value,
    realized_pnl: session.realized_pnl,
    unrealized_pnl: session.unrealized_pnl,
    roi_percent: session.roi_percent,
    total_fees: session.total_fees,
    duration_minutes: session.duration_minutes,
    // User annotations will be preserved if they exist
    trade_category: null,
    journal_entry: null,
    tags: [],
    rating: null
  }));

  // Upsert to Supabase (insert or update if exists)
  console.log('\nUpserting sessions to Supabase...');

  const { data, error } = await supabase
    .from('trade_sessions')
    .upsert(sessionsToUpsert, {
      onConflict: 'session_id,account_index',
      ignoreDuplicates: false
    })
    .select();

  if (error) {
    console.error('❌ Error syncing to Supabase:', error);
    process.exit(1);
  }

  console.log(`✅ Successfully synced ${data?.length || 0} sessions`);

  // Show summary
  const { data: allSessions, error: fetchError } = await supabase
    .from('trade_sessions')
    .select('*')
    .eq('account_index', ACCOUNT_INDEX)
    .order('entry_time', { ascending: false });

  if (fetchError) {
    console.error('❌ Error fetching sessions:', fetchError);
  } else {
    console.log('\n' + '='.repeat(80));
    console.log('DATABASE SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total sessions in DB: ${allSessions?.length || 0}`);
    console.log(`Open sessions: ${allSessions?.filter(s => s.status === 'open').length || 0}`);
    console.log(`Closed sessions: ${allSessions?.filter(s => s.status === 'closed').length || 0}`);

    const annotated = allSessions?.filter(
      s => s.trade_category || s.journal_entry || (s.tags && s.tags.length > 0)
    ).length || 0;
    console.log(`Annotated sessions: ${annotated}`);
  }
}

syncSessions().catch(console.error);
