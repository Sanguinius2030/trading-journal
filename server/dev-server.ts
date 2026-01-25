import http from 'http';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const PORT = 3001;

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/api/sync-trades' && (req.method === 'GET' || req.method === 'POST')) {
    console.log('\n🔄 Sync request received...');

    try {
      // Run the sync scripts
      console.log('📥 Fetching trades...');
      execSync('npx tsx scripts/fetch-all-trades.ts', {
        cwd: rootDir,
        stdio: 'inherit',
        env: { ...process.env }
      });

      console.log('💰 Fetching balance...');
      execSync('npx tsx scripts/fetch-balance.ts', {
        cwd: rootDir,
        stdio: 'inherit',
        env: { ...process.env }
      });

      console.log('📊 Aggregating positions...');
      execSync('npx tsx scripts/aggregate-positions.ts', {
        cwd: rootDir,
        stdio: 'inherit',
        env: { ...process.env }
      });

      // Copy to public folder
      const srcPath = path.join(rootDir, 'data', 'aggregated-positions.json');
      const destPath = path.join(rootDir, 'public', 'aggregated-positions.json');
      fs.copyFileSync(srcPath, destPath);

      // Read and return the result
      const data = JSON.parse(fs.readFileSync(destPath, 'utf-8'));

      const result = {
        positions: data.positions,
        summary: {
          total_pnl: data.positions
            .filter((p: any) => p.is_closed && p.pnl !== null)
            .reduce((sum: number, p: any) => sum + p.pnl, 0),
          total_positions: data.positions.length,
          closed_positions: data.positions.filter((p: any) => p.is_closed).length,
          open_positions: data.positions.filter((p: any) => !p.is_closed).length,
          synced_at: new Date().toISOString()
        }
      };

      console.log(`✅ Sync complete: ${result.summary.total_positions} positions`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      console.error('❌ Sync failed:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Sync failed'
      }));
    }
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n🚀 Dev API server running on http://localhost:${PORT}`);
  console.log(`   POST /api/sync-trades - Sync trading data\n`);
});
