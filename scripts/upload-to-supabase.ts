/**
 * Upload local aggregated positions and balance to Supabase
 * Run this once to seed the online version with your local data.
 *
 * Usage: npx tsx scripts/upload-to-supabase.ts <email> <password>
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
const envPath = path.join(__dirname, '..', '.env');
const envContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
const envVars: Record<string, string> = {};
envContent.split(/\r?\n/).forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      envVars[match[1].trim()] = match[2].trim();
    }
  }
});

const SUPABASE_URL = envVars.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = envVars.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

async function main() {
  // Get credentials from command line args
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: npx tsx scripts/upload-to-supabase.ts <email> <password>');
    console.error('Example: npx tsx scripts/upload-to-supabase.ts user@email.com mypassword');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Sign in
  console.log(`Signing in as ${email}...`);
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !auth.user) {
    console.error('Failed to sign in:', authError?.message || 'Unknown error');
    process.exit(1);
  }

  const userId = auth.user.id;
  console.log(`Signed in successfully (user: ${userId})\n`);

  // Read local data files
  const positionsPath = path.join(__dirname, '..', 'data', 'aggregated-positions.json');
  const balancePath = path.join(__dirname, '..', 'data', 'account-balance.json');

  if (!existsSync(positionsPath)) {
    console.error('No aggregated-positions.json found. Run the local scripts first:');
    console.error('  npx tsx scripts/fetch-all-trades.ts');
    console.error('  npx tsx scripts/aggregate-positions.ts');
    process.exit(1);
  }

  const posData = JSON.parse(readFileSync(positionsPath, 'utf-8'));
  const positions = posData.positions || [];
  console.log(`Found ${positions.length} positions to upload`);

  // First, delete existing positions for this user (clean slate)
  console.log('Clearing existing positions...');
  const { error: deleteError } = await supabase
    .from('positions')
    .delete()
    .eq('user_id', userId);

  if (deleteError) {
    console.error('Warning: Failed to clear existing positions:', deleteError.message);
  }

  // Upload positions in batches
  const batchSize = 50;
  let uploaded = 0;

  for (let i = 0; i < positions.length; i += batchSize) {
    const batch = positions.slice(i, i + batchSize).map((pos: any) => ({
      user_id: userId,
      position_id: pos.position_id,
      market_symbol: pos.market_symbol,
      position_type: pos.position_type,
      entry_time: pos.entry_time,
      exit_time: pos.exit_time,
      entry_date: pos.entry_date,
      exit_date: pos.exit_date,
      avg_entry_price: pos.avg_entry_price,
      avg_exit_price: pos.avg_exit_price,
      total_entry_value: pos.total_entry_value,
      total_exit_value: pos.total_exit_value,
      total_size: pos.total_size || pos.max_position_size,
      pnl: pos.pnl,
      total_fees: pos.total_fees,
      is_closed: pos.is_closed,
      trade_count: pos.trade_count || pos.trades?.length || 0,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('positions')
      .upsert(batch, { onConflict: 'user_id,position_id' });

    if (error) {
      console.error(`Failed to upload batch ${Math.floor(i / batchSize) + 1}:`, error.message);
    } else {
      uploaded += batch.length;
      console.log(`  Uploaded ${uploaded}/${positions.length} positions`);
    }
  }

  // Upload balance
  if (existsSync(balancePath)) {
    const balData = JSON.parse(readFileSync(balancePath, 'utf-8'));

    const balance = {
      user_id: userId,
      account_equity: parseFloat(balData.margin_balance) || parseFloat(balData.balance) || 0,
      available_balance: parseFloat(balData.free_margin) || parseFloat(balData.balance) || 0,
      unrealized_pnl: balData.unrealized_pnl || 0,
      margin_used: parseFloat(balData.margin_used) || 0,
      updated_at: new Date().toISOString(),
    };

    const { error: balError } = await supabase
      .from('account_balances')
      .upsert(balance, { onConflict: 'user_id' });

    if (balError) {
      console.error('Failed to upload balance:', balError.message);
    } else {
      console.log(`  Uploaded account balance ($${balance.available_balance.toFixed(2)})`);
    }
  }

  // Summary
  const closedCount = positions.filter((p: any) => p.is_closed).length;
  const openCount = positions.filter((p: any) => !p.is_closed).length;
  const totalPnl = positions
    .filter((p: any) => p.is_closed && p.pnl != null)
    .reduce((sum: number, p: any) => sum + p.pnl, 0);

  console.log('\n' + '='.repeat(60));
  console.log('UPLOAD COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Total positions: ${uploaded}`);
  console.log(`  Closed: ${closedCount}`);
  console.log(`  Open: ${openCount}`);
  console.log(`  Total PnL: $${totalPnl.toFixed(2)}`);
  console.log('\nRefresh your deployed app to see the data.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
