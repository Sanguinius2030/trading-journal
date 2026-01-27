# Trading Journal

A React + TypeScript trading journal for tracking positions on the [Lighter DEX](https://app.lighter.xyz). Features real-time sync, position aggregation, P&L tracking, calendar heatmaps, charts, tax reporting, and journaling.

## Architecture

```
Local Development                   Production (Vercel)
─────────────────                   ──────────────────
JSON files in /data/                Supabase (PostgreSQL)
  └─ aggregated-positions.json        └─ positions, trades, account_balances
  └─ account-balance.json             └─ position_annotations, daily/weekly journals
  └─ sdk-trades.json                  └─ user_settings

React SPA (Vite)                    React SPA (Vercel Static)
  └─ fetches from /public/*.json      └─ fetches from /api/* serverless functions

Local scripts sync data             Vercel API syncs from Lighter DEX
  └─ npx tsx scripts/...              └─ /api/sync-trades (incremental sync)
                                      └─ /api/get-positions (read positions)
                                      └─ /api/lighter-proxy (proxy API calls)
```

**Local dev** reads from static JSON files — no Supabase or auth needed.
**Production** uses Supabase for storage + auth, and Vercel serverless functions to sync from the Lighter API.

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env
# Edit .env with your Lighter API credentials

# 3. Sync trade data from Lighter DEX
npm run sync

# 4. Start dev server
npm run dev
```

Open http://localhost:5173

## Environment Variables

### Local Development (.env)

```bash
# Lighter DEX credentials (for local sync scripts)
VITE_LIGHTER_API_URL=https://mainnet.zklighter.elliot.ai
VITE_LIGHTER_AUTH_TOKEN=ro:132275:all:...    # Read-only API token from Lighter
VITE_LIGHTER_ACCOUNT_INDEX=132275            # Your Lighter account index

# Supabase (optional for local dev — falls back to JSON files)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### Production (Vercel Environment Variables)

```bash
# Required — Supabase
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...               # Public anon key (used by frontend)
SUPABASE_SERVICE_ROLE_KEY=eyJ...             # Service role key (used by API routes only)

# Optional fallbacks — Lighter DEX
# Per-user credentials are stored in Supabase user_settings table.
# These are only used if a user has no settings configured.
VITE_LIGHTER_API_URL=https://mainnet.zklighter.elliot.ai
VITE_LIGHTER_AUTH_TOKEN=ro:...
VITE_LIGHTER_ACCOUNT_INDEX=132275
```

## Database Schema (Supabase)

SQL files are in [supabase/](supabase/):

| Table | Purpose |
|-------|---------|
| `positions` | Aggregated trading positions (entry/exit prices, P&L, fees) |
| `trades` | Raw trade records from Lighter API |
| `account_balances` | Latest account equity, margin, unrealized P&L, per-position data |
| `user_settings` | Per-user Lighter API credentials and config |
| `position_annotations` | User notes/tags on individual positions |
| `daily_journals` | Daily trading journal entries |
| `weekly_journals` | Weekly trading journal entries |

All tables use Row Level Security (RLS) with `user_id = auth.uid()`.

## API Endpoints (Vercel Serverless Functions)

### `POST /api/sync-trades`
Syncs trades from Lighter DEX to Supabase. Requires auth.

- **Incremental sync**: Only fetches new trades since the last known position
- **Full sync**: On first use, fetches all trades (may timeout on Vercel Hobby — use seed script instead)
- Returns all positions + balance after sync
- Rate limited: 1 sync per 30 seconds

### `GET /api/get-positions`
Returns all positions and balance for the authenticated user.

### `GET /api/lighter-proxy`
Proxies requests to the Lighter API with endpoint whitelisting.
Query params: `endpoint` (required), plus any API params.

## Key Technical Details

### Lighter API Quirks
- `limit` parameter: max 100 (rejects anything higher with "invalid param")
- `start_time` parameter: **required** but does NOT actually filter — API always returns newest trades first regardless
- Pagination: cursor-based via `next_cursor`
- Client-side filtering is used to stop pagination when hitting already-known trades

### Sync Flow
1. Fetch + save account balance (fast, single API call)
2. Query Supabase for the latest known position timestamp (`getSyncStartTime`)
3. Fetch trades from Lighter API in batches of 100, newest-first
4. Stop when hitting trades older than `sinceTimestamp` (client-side filter)
5. Aggregate trades into positions (group by market, track open/close)
6. Upsert new/updated positions to Supabase
7. Return all positions from Supabase

### Position Aggregation
- Trades are grouped by market, sorted chronologically
- A new position starts when `positionBefore ≈ 0`
- A position closes when `positionAfter ≈ 0`
- P&L = sell_value - buy_value - fees (for longs; inverse for shorts)
- Positions starting before 2025-12-19 are filtered out

## Project Structure

```
├── api/                        # Vercel serverless functions
│   ├── sync-trades.ts          # Trade sync + aggregation engine
│   ├── get-positions.ts        # Read positions from Supabase
│   └── lighter-proxy.ts        # Proxy to Lighter API
│
├── src/
│   ├── App.tsx                 # Main app (routing, sync trigger, tabs)
│   ├── components/
│   │   ├── AggregatedPositionsTable.tsx  # Positions list + detail view
│   │   ├── CalendarHeatmap.tsx           # Daily P&L calendar
│   │   ├── ChartsTab.tsx                 # P&L charts
│   │   ├── StatsTab.tsx                  # Trading statistics
│   │   ├── TaxTab.tsx                    # Tax calculations
│   │   ├── KPISidebar.tsx                # Key metrics sidebar
│   │   ├── GrowthProjection.tsx          # Growth projection chart
│   │   ├── Auth/LoginPage.tsx            # Login form
│   │   ├── Auth/AuthProvider.tsx         # Auth context
│   │   └── Settings/SettingsPage.tsx     # User settings
│   ├── hooks/
│   │   ├── usePositions.ts     # Fetch positions (Supabase or JSON)
│   │   └── useAuth.ts          # Auth state
│   ├── services/
│   │   └── supabaseData.ts     # Data layer (fetch/save positions, annotations, journals)
│   └── lib/
│       └── supabase.ts         # Supabase client init
│
├── scripts/                    # Local CLI scripts
│   ├── fetch-all-trades.ts     # Fetch trades from Lighter API → JSON
│   ├── aggregate-positions.ts  # Aggregate trades → positions JSON
│   ├── fetch-balance.ts        # Fetch account balance → JSON
│   ├── upload-to-supabase.ts   # Seed Supabase from local JSON
│   └── sync-to-supabase.ts     # Sync local data to Supabase
│
├── supabase/                   # Database schema SQL files
├── data/                       # Local JSON data (git-tracked)
├── public/                     # Static assets served by Vite
├── vercel.json                 # Vercel config (function timeouts, rewrites, headers)
└── package.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | TypeScript check + Vite production build |
| `npm run sync` | Fetch trades + aggregate + copy to public/ |
| `npm run lint` | Run ESLint |
| `npx tsx scripts/upload-to-supabase.ts` | Seed Supabase from local JSON data |
| `npx tsx scripts/fetch-balance.ts` | Fetch current account balance |

## Deployment (Vercel)

1. Push to GitHub
2. Connect repo to Vercel
3. Set environment variables (see above)
4. Deploy — Vercel auto-detects Vite and API routes

**First-time setup**: After deploying, run `npx tsx scripts/upload-to-supabase.ts` to seed historical data. The Vercel sync endpoint has a 60s timeout which isn't enough for a full history fetch on Hobby plan.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 7, Recharts, Lucide icons
- **Backend**: Vercel Serverless Functions
- **Database**: Supabase (PostgreSQL + Auth + RLS)
- **Exchange**: Lighter DEX (zkSync)
- **Styling**: CSS with Gilroy font family
