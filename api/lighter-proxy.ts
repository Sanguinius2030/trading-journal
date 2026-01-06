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
    // Log environment variables (first few chars only for security)
    console.log('Environment check:', {
      hasApiKey: !!LIGHTER_API_KEY,
      apiKeyLength: LIGHTER_API_KEY?.length || 0,
      apiKeyPrefix: LIGHTER_API_KEY?.substring(0, 8) || 'missing',
      baseUrl: LIGHTER_API_BASE_URL,
    });

    const { endpoint, ...params } = req.query;

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'Missing endpoint parameter' });
    }

    // Build query string
    const queryString = new URLSearchParams(params as Record<string, string>).toString();
    const url = `${LIGHTER_API_BASE_URL}/api/v1/${endpoint}${queryString ? `?${queryString}` : ''}`;

    console.log('Proxying request:', {
      endpoint,
      params,
      queryString,
      fullUrl: url,
    });

    // Note: accountsByL1Address is a public endpoint that doesn't require API key
    // Only add API key header if we have one AND it's needed for authenticated endpoints
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Some endpoints may need API key - add it for authenticated endpoints
    const authenticatedEndpoints = ['trades', 'accountActiveOrders', 'accountInactiveOrders'];
    if (LIGHTER_API_KEY && authenticatedEndpoints.some(e => endpoint.includes(e))) {
      headers['x-api-key'] = LIGHTER_API_KEY;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    console.log('Lighter API response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    });

    if (!response.ok) {
      // Try to get error details from response body
      const errorText = await response.text();
      console.error('Lighter API error details:', errorText);

      return res.status(response.status).json({
        error: `Lighter API error: ${response.status} ${response.statusText}`,
        details: errorText,
      });
    }

    const data = await response.json();
    console.log('Lighter API success, data keys:', Object.keys(data));
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
