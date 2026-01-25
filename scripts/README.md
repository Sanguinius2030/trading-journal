# Lighter API Data Scripts

This directory contains scripts for fetching and analyzing trading data from Lighter DEX.

## Main Scripts

### `fetch-data.ts`
Fetches all trading data from Lighter API using the TypeScript SDK.

**Usage:**
```bash
npx tsx scripts/fetch-data.ts
```

**Output Files:**
- `data/sdk-trades.json` - Trade history
- `data/sdk-inactive-orders.json` - Order history
- `data/lighter-account-data.json` - Current account balance & positions

### `analyze-data.ts`
Analyzes trading data and generates reports.

**Usage:**
```bash
npx tsx scripts/analyze-data.ts
```

**Output Files:**
- `data/trading-summary.json` - Statistical summary
- `reports/TRADING-REPORT.md` - Human-readable report

## Configuration

Create a `.env` file with:
```
VITE_LIGHTER_API_URL=https://mainnet.zklighter.elliot.ai
VITE_LIGHTER_AUTH_TOKEN=ro:132275:all:1784381145:...
VITE_LIGHTER_ACCOUNT_INDEX=132275
```

## Dependencies

- `@oraichain/lighter-ts-sdk` - Official Lighter TypeScript SDK

## Data Structure

All data is stored in JSON format:
- `data/` - Raw API responses
- `reports/` - Generated reports and analysis
