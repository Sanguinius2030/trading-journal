# Local Data Scripts

CLI scripts for fetching and processing trading data from the Lighter DEX API.
These are used for **local development** — production uses Vercel serverless functions instead.

## Scripts

### `fetch-all-trades.ts`
Fetches all trades from the Lighter API and saves to `data/sdk-trades.json`.

```bash
npx tsx scripts/fetch-all-trades.ts
```

### `aggregate-positions.ts`
Reads raw trades from `data/sdk-trades.json`, aggregates them into positions, and writes `data/aggregated-positions.json`.

```bash
npx tsx scripts/aggregate-positions.ts
```

### `fetch-balance.ts`
Fetches current account balance and open positions from the Lighter API.

```bash
npx tsx scripts/fetch-balance.ts
```

### `upload-to-supabase.ts`
Seeds Supabase with local JSON data. Useful for initial production setup (Vercel's 60s timeout can't do a full history fetch).

```bash
npx tsx scripts/upload-to-supabase.ts
```

### `sync-to-supabase.ts`
Syncs local aggregated data to Supabase.

```bash
npx tsx scripts/sync-to-supabase.ts
```

## Quick Sync (Local)

The `npm run sync` command runs fetch + aggregate + copy in sequence:

```bash
npm run sync
```

## Configuration

Requires a `.env` file in the project root:

```bash
VITE_LIGHTER_API_URL=https://mainnet.zklighter.elliot.ai
VITE_LIGHTER_AUTH_TOKEN=ro:132275:all:...
VITE_LIGHTER_ACCOUNT_INDEX=132275
VITE_SUPABASE_URL=https://xxx.supabase.co       # for upload/sync scripts
VITE_SUPABASE_ANON_KEY=eyJ...                    # for upload/sync scripts
```
