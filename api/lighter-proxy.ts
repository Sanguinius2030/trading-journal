import type { VercelRequest, VercelResponse } from '@vercel/node';

const LIGHTER_API_BASE_URL = process.env.VITE_LIGHTER_API_URL || 'https://mainnet.zklighter.elliot.ai';
const LIGHTER_API_KEY = process.env.VITE_LIGHTER_API_KEY || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { endpoint, ...params } = req.query;

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'Missing endpoint parameter' });
    }

    // Build query string
    const queryString = new URLSearchParams(params as Record<string, string>).toString();
    const url = `${LIGHTER_API_BASE_URL}/api/v1/${endpoint}${queryString ? `?${queryString}` : ''}`;

    console.log('Proxying request to:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': LIGHTER_API_KEY,
      },
    });

    if (!response.ok) {
      console.error('Lighter API error:', response.status, response.statusText);
      return res.status(response.status).json({
        error: `Lighter API error: ${response.status} ${response.statusText}`,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
