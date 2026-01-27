import type { VercelRequest, VercelResponse } from '@vercel/node';

const LIGHTER_API_BASE_URL = process.env.VITE_LIGHTER_API_URL || 'https://mainnet.zklighter.elliot.ai';
const LIGHTER_EXPLORER_URL = 'https://explorer.elliot.ai';
const LIGHTER_API_KEY = process.env.VITE_LIGHTER_API_KEY || '';

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://trading-journal-2026.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

// Whitelist of allowed API endpoints to prevent path traversal
const ALLOWED_ENDPOINTS = [
  'markets',
  'order_book_details',
  'trades',
  'account',
  'liquidations',
];

function isAllowedEndpoint(endpoint: string): boolean {
  // Allow exact matches from whitelist
  if (ALLOWED_ENDPOINTS.includes(endpoint)) return true;
  // Allow accounts/{number}/positions pattern for explorer API
  if (/^accounts\/\d+\/positions$/.test(endpoint)) return true;
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS with origin whitelist
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Lighter-Auth');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { endpoint, ...params } = req.query;

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'Missing endpoint parameter' });
    }

    // Validate endpoint against whitelist
    if (!isAllowedEndpoint(endpoint)) {
      return res.status(400).json({ error: 'Invalid endpoint' });
    }

    // Get auth token from custom header if provided
    const authToken = req.headers['x-lighter-auth'] as string | undefined;

    // If auth token in header, add it to params for the API call
    if (authToken) {
      (params as any).auth = authToken;
    }

    // Build query string - URLSearchParams handles encoding
    const queryString = new URLSearchParams(params as Record<string, string>).toString();

    // Use explorer URL for positions endpoint
    let url: string;
    if (endpoint.startsWith('accounts/') && endpoint.includes('/positions')) {
      url = `${LIGHTER_EXPLORER_URL}/api/${endpoint}`;
    } else {
      url = `${LIGHTER_API_BASE_URL}/api/v1/${endpoint}${queryString ? `?${queryString}` : ''}`;
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'TradingJournal/1.0',
    };

    if (LIGHTER_API_KEY) {
      headers['x-api-key'] = LIGHTER_API_KEY;
    }

    // Explorer API may need different headers
    if (endpoint.startsWith('accounts/')) {
      headers['Origin'] = 'https://explorer.elliot.ai';
      headers['Referer'] = 'https://explorer.elliot.ai/';
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lighter API error:', response.status, endpoint);

      return res.status(response.status).json({
        error: `Lighter API error: ${response.status} ${response.statusText}`,
        details: errorText,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy error:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
