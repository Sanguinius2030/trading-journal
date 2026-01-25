/**
 * Fetch account balance from Lighter API
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { ApiClient, AccountApi } from '@oraichain/lighter-ts-sdk';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
const envPath = path.join(__dirname, '..', '.env');
const envContent = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
const envVars: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const LIGHTER_API_URL = envVars.VITE_LIGHTER_API_URL || 'https://mainnet.zklighter.ellipsis.finance';
const ACCOUNT_INDEX = parseInt(envVars.VITE_LIGHTER_ACCOUNT_INDEX || '132275');

interface BalanceData {
  account_index: number;
  balance: string;
  margin_balance: string;
  free_margin: string;
  margin_used: string;
  unrealized_pnl: number;
  positions: Array<{
    market_id: number;
    symbol: string;
    position: string;
    unrealized_pnl: string;
    position_value: string;
  }>;
  fetched_at: string;
}

async function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  const dataFile = path.join(dataDir, 'account-balance.json');

  console.log('='.repeat(80));
  console.log('FETCHING LIGHTER ACCOUNT BALANCE');
  console.log('='.repeat(80));
  console.log(`Account Index: ${ACCOUNT_INDEX}\n`);

  const apiClient = new ApiClient(LIGHTER_API_URL);
  const accountApi = new AccountApi(apiClient);

  try {
    const accounts = await accountApi.getAccount({
      by: 'index',
      value: String(ACCOUNT_INDEX)
    });

    if (!accounts || accounts.length === 0) {
      throw new Error('No account found');
    }

    const account = accounts[0] as any;

    console.log('Account Data:');
    console.log(`  Available Balance: $${parseFloat(account.available_balance).toFixed(2)}`);
    console.log(`  Collateral: $${parseFloat(account.collateral).toFixed(2)}`);
    console.log(`  Total Asset Value: $${parseFloat(account.total_asset_value || '0').toFixed(2)}`);

    // Calculate total unrealized PnL from positions
    let totalUnrealizedPnl = 0;
    if (account.positions && account.positions.length > 0) {
      console.log('\nOpen Positions:');
      account.positions.forEach(pos => {
        const pnl = parseFloat(pos.unrealized_pnl);
        totalUnrealizedPnl += pnl;
        console.log(`  ${pos.symbol}: ${parseFloat(pos.position).toFixed(4)} @ $${parseFloat(pos.avg_entry_price).toFixed(2)} | uPnL: $${pnl.toFixed(2)}`);
      });
    }

    console.log(`\nTotal Unrealized PnL: $${totalUnrealizedPnl.toFixed(2)}`);

    const balanceData: BalanceData = {
      account_index: ACCOUNT_INDEX,
      balance: account.available_balance || account.collateral || '0',
      margin_balance: account.total_asset_value || account.collateral || '0', // Perpetual Equity (includes unrealized PnL)
      free_margin: account.available_balance || '0',
      margin_used: '0', // Calculate from positions if needed
      unrealized_pnl: totalUnrealizedPnl,
      positions: (account.positions || []).map((pos: any) => ({
        market_id: pos.market_id,
        symbol: pos.symbol,
        position: pos.position,
        unrealized_pnl: pos.unrealized_pnl,
        position_value: pos.position_value
      })),
      fetched_at: new Date().toISOString()
    };

    writeFileSync(dataFile, JSON.stringify(balanceData, null, 2), 'utf-8');
    console.log(`\n✅ Saved balance data to data/account-balance.json`);

    // Also copy to public folder for frontend access
    const publicDir = path.join(__dirname, '..', 'public', 'data');
    if (!existsSync(publicDir)) {
      mkdirSync(publicDir, { recursive: true });
    }
    const publicFile = path.join(publicDir, 'account-balance.json');
    writeFileSync(publicFile, JSON.stringify(balanceData, null, 2), 'utf-8');
    console.log(`✅ Copied to public/data/account-balance.json`);

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    process.exit(1);
  }
}

main();
