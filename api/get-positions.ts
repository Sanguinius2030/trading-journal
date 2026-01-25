import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Supabase setup for server-side operations
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function getUserFromToken(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.error('Auth error:', error);
      return null;
    }
    return user.id;
  } catch (err) {
    console.error('Failed to verify token:', err);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user
    const userId = await getUserFromToken(req.headers.authorization);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('Fetching positions for user:', userId);

    // Fetch positions from Supabase
    const { data: positions, error: positionsError } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .order('entry_time', { ascending: false });

    if (positionsError) {
      console.error('Failed to fetch positions:', positionsError);
      return res.status(500).json({ error: 'Failed to fetch positions' });
    }

    // Fetch account balance
    const { data: balance, error: balanceError } = await supabase
      .from('account_balances')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (balanceError && balanceError.code !== 'PGRST116') {
      console.error('Failed to fetch balance:', balanceError);
    }

    // Calculate summary
    const closedPositions = positions?.filter(p => p.is_closed) || [];
    const openPositions = positions?.filter(p => !p.is_closed) || [];
    const totalPnL = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);

    const result = {
      positions: positions || [],
      balance: balance || null,
      summary: {
        total_pnl: totalPnL,
        total_positions: positions?.length || 0,
        closed_positions: closedPositions.length,
        open_positions: openPositions.length,
        fetched_at: new Date().toISOString()
      }
    };

    console.log('Fetched positions:', result.summary);

    return res.status(200).json(result);
  } catch (error) {
    console.error('Get positions error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
