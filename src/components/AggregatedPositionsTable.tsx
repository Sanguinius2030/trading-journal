import { useState, useEffect, useMemo } from 'react';
import { usePositions } from '../hooks/usePositions';
import { useAuthContext } from './Auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';

interface Trade {
  trade_id: number;
  timestamp: number;
  date_time: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  usd_amount: number;
  fee: number;
  position_before: number;
  position_after: number;
}

interface AggregatedPosition {
  position_id: string;
  market_id: number;
  market_symbol: string;
  entry_time: number;
  exit_time: number | null;
  entry_date: string;
  exit_date: string | null;
  trades?: Trade[];
  trade_count?: number;
  max_position_size?: number;
  total_size?: number;
  avg_entry_price: number;
  avg_exit_price: number | null;
  total_entry_value: number;
  total_exit_value: number;
  total_fees: number;
  total_funding?: number;  // Funding payments (positive = received, negative = paid)
  pnl: number | null;
  realized_pnl?: number;  // For open positions: realized P&L from partial closes
  position_type: 'LONG' | 'SHORT';
  is_closed: boolean;
}

interface PositionAnnotation {
  position_id: string;
  journal_entry?: string | null;
  category?: string | null;
  subcategory?: string | null;
  timeframe?: string | null;
  setup_thesis?: string | null;
  did_well?: string | null;
  could_improve?: string | null;
  emotions?: string | null;
  other_notes?: string | null;
  tags?: string[];
}

interface DayGroup {
  date: string;
  displayDate: string;
  positions: AggregatedPosition[];
  dayPnL: number;
  dayPnLPercent: number;  // Percentage gain based on previous day's portfolio value
  isToday?: boolean;
  unrealizedPnL?: number;
}

interface DailyJournal {
  date: string;
  market_context?: string | null;
  daily_plan?: string | null;
  execution_review?: string | null;
  key_lessons?: string | null;
  emotions_summary?: string | null;
  rating?: number | null;
}

interface WeeklyJournal {
  week_start: string;
  week_end: string;
  weekly_goals?: string | null;
  market_overview?: string | null;
  performance_review?: string | null;
  biggest_wins?: string | null;
  biggest_lessons?: string | null;
  areas_to_improve?: string | null;
  next_week_focus?: string | null;
  rating?: number | null;
}

interface WeekGroup {
  weekStart: string;        // DD/MM/YYYY format (Monday)
  weekEnd: string;          // DD/MM/YYYY format (Sunday)
  displayWeek: string;      // Human readable week range
  days: DayGroup[];
  weekPnL: number;
  weekPnLPercent: number;   // Percentage gain based on previous week's ending portfolio value
  prevWeekEndPortfolio: number; // Portfolio value at start of this week (for percentage calculations)
  totalPositions: number;
  isCurrentWeek?: boolean;
  unrealizedPnL?: number;   // Unrealized P&L for current week only
}

interface BalancePosition {
  market_id: number;
  symbol: string;
  position: string;
  unrealized_pnl: string;
  position_value: string;
}

interface BalanceData {
  unrealized_pnl: number;
  positions?: BalancePosition[];
}

const STARTING_CAPITAL = 10000;
const FEES_STORAGE_KEY = 'trading-journal-fees-expenses';

export function AggregatedPositionsTable() {
  const { user } = useAuthContext();
  const { positions: rawPositions, loading, balance } = usePositions();
  const isMobile = useIsMobile();

  // Cast positions to the local type
  const positions = rawPositions as unknown as AggregatedPosition[];

  // Convert balance to the expected format
  const balanceData: BalanceData | null = balance ? {
    unrealized_pnl: balance.unrealized_pnl || 0,
    positions: balance.positions,
  } : null;

  const [annotations, setAnnotations] = useState<Map<string, PositionAnnotation>>(new Map());
  const [dailyJournals, setDailyJournals] = useState<Map<string, DailyJournal>>(new Map());
  const [weeklyJournals, setWeeklyJournals] = useState<Map<string, WeeklyJournal>>(new Map());
  const [feesExpenses, setFeesExpenses] = useState<number>(() => {
    const stored = localStorage.getItem(FEES_STORAGE_KEY);
    return stored ? parseFloat(stored) : 0;
  });
  const [expandedPositionId, setExpandedPositionId] = useState<string | null>(null);

  // Listen for fees changes from KPISidebar
  useEffect(() => {
    const handleFeesChange = () => {
      const stored = localStorage.getItem(FEES_STORAGE_KEY);
      setFeesExpenses(stored ? parseFloat(stored) : 0);
    };
    window.addEventListener('fees-expenses-changed', handleFeesChange);
    return () => window.removeEventListener('fees-expenses-changed', handleFeesChange);
  }, []);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [editingDailyJournal, setEditingDailyJournal] = useState<string | null>(null);
  const [editingWeeklyJournal, setEditingWeeklyJournal] = useState<string | null>(null);
  const [categories] = useState([
    { value: 'trend', label: 'Trend', description: 'Trading with momentum, continuation plays' },
    { value: 'range', label: 'Range', description: 'Mean reversion, support/resistance bounces' },
    { value: 'breakout', label: 'Breakout', description: 'Volatility expansion, level breaks' },
    { value: 'reversal', label: 'Reversal', description: 'Counter-trend, exhaustion plays' },
    { value: 'event', label: 'Event', description: 'News, data releases, liquidation cascades' }
  ]);

  const [timeframes] = useState([
    { value: 'scalp', label: 'Scalp' },
    { value: 'intraday', label: 'Intraday' },
    { value: 'swing', label: 'Swing' }
  ]);

  // Predefined emotions for multi-select
  const emotionOptions = [
    'Confident', 'Calm', 'Focused', 'Patient',
    'Anxious', 'FOMO', 'Revenge', 'Frustrated',
    'Greedy', 'Hesitant', 'Impulsive', 'Tired'
  ];

  // Filter state
  const [filters, setFilters] = useState({
    pnlFilter: 'all' as 'all' | 'positive' | 'negative',
    categoryFilter: '' as string,
    timeframeFilter: '' as string,
    setupFilter: '' as string,
    sideFilter: 'all' as 'all' | 'long' | 'short',
    marketFilter: '' as string,
    dateFilter: 'all' as 'all' | 'today' | 'this-week',
  });

  const [showFilters, setShowFilters] = useState(false);

  // Get unique setups/subcategories from annotations
  const uniqueSetups = useMemo(() => {
    const setups = new Set<string>();
    annotations.forEach(ann => {
      if (ann.subcategory) setups.add(ann.subcategory);
    });
    return Array.from(setups).sort();
  }, [annotations]);

  // Get unique markets from positions
  const uniqueMarkets = useMemo(() => {
    const markets = new Set<string>();
    positions.forEach(p => markets.add(p.market_symbol));
    return Array.from(markets).sort();
  }, [positions]);


  // Load annotations from Supabase
  useEffect(() => {
    const loadAnnotations = async () => {
      const query = supabase
        .from('position_annotations')
        .select('*');

      if (user) {
        query.eq('user_id', user.id);
      } else {
        query.eq('account_index', 132275);
      }

      const { data, error } = await query;

      if (!error && data) {
        const annotationsMap = new Map();
        data.forEach((ann: any) => {
          annotationsMap.set(ann.position_id, ann);
        });
        setAnnotations(annotationsMap);
      } else if (error) {
        console.error('Failed to load annotations:', error);
      }
    };

    loadAnnotations();
  }, [user]);

  // Load daily journals from Supabase
  useEffect(() => {
    const loadDailyJournals = async () => {
      const query = supabase
        .from('daily_journals')
        .select('*');

      if (user) {
        query.eq('user_id', user.id);
      } else {
        query.eq('account_index', 132275);
      }

      const { data, error } = await query;

      if (!error && data) {
        const journalsMap = new Map();
        data.forEach((journal: any) => {
          journalsMap.set(journal.date, journal);
        });
        setDailyJournals(journalsMap);
      } else if (error) {
        console.error('Failed to load daily journals:', error);
      }
    };

    loadDailyJournals();
  }, [user]);

  // Load weekly journals from Supabase
  useEffect(() => {
    const loadWeeklyJournals = async () => {
      const query = supabase
        .from('weekly_journals')
        .select('*');

      if (user) {
        query.eq('user_id', user.id);
      } else {
        query.eq('account_index', 132275);
      }

      const { data, error } = await query;

      if (!error && data) {
        const journalsMap = new Map();
        data.forEach((journal: any) => {
          journalsMap.set(journal.week_start, journal);
        });
        setWeeklyJournals(journalsMap);
      } else if (error) {
        console.error('Failed to load weekly journals:', error);
      }
    };

    loadWeeklyJournals();
  }, [user]);

  // Group positions by day and sort chronologically (including empty days)
  const dayGroups = useMemo(() => {
    if (positions.length === 0) return [];

    // Sort positions by entry_time (newest first for reverse chronological order)
    const sortedPositions = [...positions].sort((a, b) => b.entry_time - a.entry_time);

    // Group by day (using entry date)
    const groups = new Map<string, AggregatedPosition[]>();

    sortedPositions.forEach(position => {
      // Extract just the date part (DD/MM/YYYY)
      const datePart = position.entry_date.split(' ')[0];
      if (!groups.has(datePart)) {
        groups.set(datePart, []);
      }
      groups.get(datePart)!.push(position);
    });

    // Find the date range (earliest trading day to today)
    let minDate: Date | null = null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let maxDate: Date = today; // Always include up to today

    groups.forEach((_, dateStr) => {
      const [day, month, year] = dateStr.split('/').map(Number);
      const date = new Date(year, month - 1, day);
      if (!minDate || date < minDate) minDate = date;
    });

    if (!minDate) return [];

    // First pass: Calculate daily PnL in chronological order to build portfolio values
    const dailyPnLMap = new Map<string, number>();
    const portfolioValueMap = new Map<string, number>(); // Portfolio value at END of each day

    let portfolioValue = STARTING_CAPITAL;
    const chronoDate = new Date(minDate);
    const endDate = new Date(maxDate);
    endDate.setHours(0, 0, 0, 0);

    while (chronoDate <= endDate) {
      const day = chronoDate.getDate().toString().padStart(2, '0');
      const month = (chronoDate.getMonth() + 1).toString().padStart(2, '0');
      const year = chronoDate.getFullYear();
      const dateKey = `${day}/${month}/${year}`;

      const dayPositions = groups.get(dateKey) || [];
      const dayPnL = dayPositions.reduce((sum, p) => {
        if (p.is_closed && p.pnl !== null) return sum + p.pnl;
        if (!p.is_closed && p.realized_pnl) return sum + p.realized_pnl;
        return sum;
      }, 0);

      dailyPnLMap.set(dateKey, dayPnL);
      portfolioValue += dayPnL;
      portfolioValueMap.set(dateKey, portfolioValue);

      chronoDate.setDate(chronoDate.getDate() + 1);
    }

    // Second pass: Generate all days with percentage calculations (newest first)
    const allDays: DayGroup[] = [];
    const currentDate = new Date(maxDate);
    currentDate.setHours(0, 0, 0, 0);
    const startDate = new Date(minDate);
    startDate.setHours(0, 0, 0, 0);

    while (currentDate >= startDate) {
      const day = currentDate.getDate().toString().padStart(2, '0');
      const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
      const year = currentDate.getFullYear();
      const dateKey = `${day}/${month}/${year}`;

      const dayPositions = groups.get(dateKey) || [];
      const dayPnL = dailyPnLMap.get(dateKey) || 0;

      // Calculate percentage: Get previous day's ending portfolio value
      const prevDate = new Date(currentDate);
      prevDate.setDate(prevDate.getDate() - 1);
      const prevDay = prevDate.getDate().toString().padStart(2, '0');
      const prevMonth = (prevDate.getMonth() + 1).toString().padStart(2, '0');
      const prevYear = prevDate.getFullYear();
      const prevDateKey = `${prevDay}/${prevMonth}/${prevYear}`;

      // If previous day exists in our data, use its ending value; otherwise use starting capital
      const prevPortfolioValue = portfolioValueMap.get(prevDateKey) ?? STARTING_CAPITAL;

      // Check if this is today
      const isToday = currentDate.getTime() === today.getTime();

      // For today, include unrealized PnL in percentage calculation
      const effectiveDayPnL = isToday && balanceData
        ? dayPnL + (balanceData.unrealized_pnl || 0)
        : dayPnL;
      const dayPnLPercent = prevPortfolioValue !== 0 ? (effectiveDayPnL / prevPortfolioValue) * 100 : 0;

      const displayDate = currentDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      allDays.push({
        date: dateKey,
        displayDate,
        positions: dayPositions,
        dayPnL,
        dayPnLPercent,
        isToday,
        unrealizedPnL: isToday && balanceData ? balanceData.unrealized_pnl : undefined
      });

      // Move to previous day
      currentDate.setDate(currentDate.getDate() - 1);
    }

    return allDays;
  }, [positions, balanceData]);

  // Apply filters to day groups
  // Helper to check if a date is in the current week
  const getWeekBounds = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { monday, sunday };
  };

  const filteredDayGroups = useMemo(() => {
    return dayGroups.map(dayGroup => {
      // Filter positions within each day
      const filteredPositions = dayGroup.positions.filter(position => {
        const annotation = annotations.get(position.position_id);

        // PnL filter
        if (filters.pnlFilter === 'positive' && (position.pnl === null || position.pnl < 0)) return false;
        if (filters.pnlFilter === 'negative' && (position.pnl === null || position.pnl >= 0)) return false;

        // Category filter
        if (filters.categoryFilter && annotation?.category !== filters.categoryFilter) return false;

        // Timeframe filter
        if (filters.timeframeFilter && annotation?.timeframe !== filters.timeframeFilter) return false;

        // Setup/subcategory filter
        if (filters.setupFilter && annotation?.subcategory !== filters.setupFilter) return false;

        // Side filter
        if (filters.sideFilter === 'long' && position.position_type !== 'LONG') return false;
        if (filters.sideFilter === 'short' && position.position_type !== 'SHORT') return false;

        // Market filter
        if (filters.marketFilter && position.market_symbol !== filters.marketFilter) return false;

        return true;
      });

      // Recalculate day PnL based on filtered positions
      const filteredDayPnL = filteredPositions.reduce((sum, p) => {
        if (p.is_closed && p.pnl !== null) return sum + p.pnl;
        if (!p.is_closed && p.realized_pnl) return sum + p.realized_pnl;
        return sum;
      }, 0);

      return {
        ...dayGroup,
        positions: filteredPositions,
        dayPnL: filteredDayPnL
      };
    }).filter(dayGroup => {
      // Date filter - filter at day level
      if (filters.dateFilter !== 'all') {
        const [d, m, y] = dayGroup.date.split('/').map(Number);
        const dayDate = new Date(y, m - 1, d);

        if (filters.dateFilter === 'today') {
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          if (dayDate.getTime() !== today.getTime()) return false;
        } else if (filters.dateFilter === 'this-week') {
          const { monday, sunday } = getWeekBounds();
          if (dayDate < monday || dayDate > sunday) return false;
        }
      }

      // Hide empty days when any filter is active
      const anyFilterActive = filters.pnlFilter !== 'all' ||
        filters.categoryFilter !== '' ||
        filters.timeframeFilter !== '' ||
        filters.setupFilter !== '' ||
        filters.sideFilter !== 'all' ||
        filters.marketFilter !== '';

      if (anyFilterActive && dayGroup.positions.length === 0) return false;

      // Day-level PnL filter (for days with trades)
      if (dayGroup.positions.length > 0) {
        if (filters.pnlFilter === 'positive' && dayGroup.dayPnL < 0) return false;
        if (filters.pnlFilter === 'negative' && dayGroup.dayPnL >= 0) return false;
      }
      return true;
    });
  }, [dayGroups, filters, annotations]);

  // Group days into weeks (Monday to Sunday)
  const weekGroups = useMemo(() => {
    if (filteredDayGroups.length === 0) return [];

    // Helper to get Monday of the week for a given date
    const getMonday = (dateStr: string): Date => {
      const [day, month, year] = dateStr.split('/').map(Number);
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday = 6 days back, else normal
      date.setDate(date.getDate() - diff);
      return date;
    };

    // Helper to format date as DD/MM/YYYY
    const formatDate = (date: Date): string => {
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    // Group days by week
    const weeksMap = new Map<string, DayGroup[]>();

    filteredDayGroups.forEach(dayGroup => {
      const monday = getMonday(dayGroup.date);
      const weekKey = formatDate(monday);

      if (!weeksMap.has(weekKey)) {
        weeksMap.set(weekKey, []);
      }
      weeksMap.get(weekKey)!.push(dayGroup);
    });

    // First, calculate cumulative PnL up to each week to determine portfolio values
    // Get all weeks sorted chronologically (oldest first)
    const weekKeys = Array.from(weeksMap.keys()).sort((a, b) => {
      const [d1, m1, y1] = a.split('/').map(Number);
      const [d2, m2, y2] = b.split('/').map(Number);
      return new Date(y1, m1 - 1, d1).getTime() - new Date(y2, m2 - 1, d2).getTime();
    });

    // Build portfolio value at end of each week
    const weekEndPortfolioMap = new Map<string, number>();
    let cumulativePortfolio = STARTING_CAPITAL;

    weekKeys.forEach(weekStart => {
      const days = weeksMap.get(weekStart)!;
      const weekPnL = days.reduce((sum, d) => sum + d.dayPnL, 0);
      cumulativePortfolio += weekPnL;
      weekEndPortfolioMap.set(weekStart, cumulativePortfolio);
    });

    // Determine current week's Monday
    const today = new Date();
    const currentDayOfWeek = today.getDay();
    const daysToMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
    const currentWeekMonday = new Date(today);
    currentWeekMonday.setDate(today.getDate() - daysToMonday);
    currentWeekMonday.setHours(0, 0, 0, 0);
    const currentWeekStart = formatDate(currentWeekMonday);

    // Convert to array and calculate week stats
    const weeks: WeekGroup[] = [];

    weeksMap.forEach((days, weekStart) => {
      // Calculate Sunday (week end)
      const [day, month, year] = weekStart.split('/').map(Number);
      const monday = new Date(year, month - 1, day);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const weekEnd = formatDate(sunday);

      // Sort days within week (newest first)
      days.sort((a, b) => {
        const [d1, m1, y1] = a.date.split('/').map(Number);
        const [d2, m2, y2] = b.date.split('/').map(Number);
        return new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime();
      });

      // Calculate week PnL and total positions
      const weekPnL = days.reduce((sum, d) => sum + d.dayPnL, 0);
      const totalPositions = days.reduce((sum, d) => sum + d.positions.length, 0);

      // Calculate percentage: Get previous week's ending portfolio value
      const weekIndex = weekKeys.indexOf(weekStart);
      const prevWeekStart = weekIndex > 0 ? weekKeys[weekIndex - 1] : null;
      const prevWeekEndPortfolio = prevWeekStart ? weekEndPortfolioMap.get(prevWeekStart)! : STARTING_CAPITAL;
      const weekPnLPercent = prevWeekEndPortfolio !== 0 ? (weekPnL / prevWeekEndPortfolio) * 100 : 0;

      // Format display string
      const displayWeek = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

      // Check if this is the current week
      const isCurrentWeek = weekStart === currentWeekStart;

      weeks.push({
        weekStart,
        weekEnd,
        displayWeek,
        days,
        weekPnL,
        weekPnLPercent,
        prevWeekEndPortfolio,
        totalPositions,
        isCurrentWeek,
        unrealizedPnL: isCurrentWeek && balanceData ? balanceData.unrealized_pnl : undefined
      });
    });

    // Sort weeks newest first
    weeks.sort((a, b) => {
      const [d1, m1, y1] = a.weekStart.split('/').map(Number);
      const [d2, m2, y2] = b.weekStart.split('/').map(Number);
      return new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime();
    });

    return weeks;
  }, [filteredDayGroups, balanceData]);

  // Check if any filters are active
  const hasActiveFilters = filters.pnlFilter !== 'all' ||
    filters.categoryFilter !== '' ||
    filters.timeframeFilter !== '' ||
    filters.setupFilter !== '' ||
    filters.sideFilter !== 'all' ||
    filters.marketFilter !== '' ||
    filters.dateFilter !== 'all';

  const clearFilters = () => {
    setFilters({
      pnlFilter: 'all',
      categoryFilter: '',
      timeframeFilter: '',
      setupFilter: '',
      sideFilter: 'all',
      marketFilter: '',
      dateFilter: 'all',
    });
  };

  // Days and weeks start collapsed by default (empty Sets)

  const handleSaveAnnotation = async (positionId: string, data: {
    category: string;
    subcategory: string;
    timeframe: string;
    did_well: string;
    could_improve: string;
    emotions: string;
  }) => {
    try {
      const annotation = {
        position_id: positionId,
        account_index: 132275,
        category: data.category || null,
        subcategory: data.subcategory || null,
        timeframe: data.timeframe || null,
        did_well: data.did_well || null,
        could_improve: data.could_improve || null,
        emotions: data.emotions || null,
        updated_at: new Date().toISOString()
      };

      const upsertData = user ? { ...annotation, user_id: user.id } : annotation;
      const { error } = await supabase
        .from('position_annotations')
        .upsert(upsertData, {
          onConflict: user ? 'user_id,position_id' : 'position_id,account_index'
        });

      if (error) throw error;

      setAnnotations(prev => new Map(prev).set(positionId, annotation));
      setEditingPositionId(null);
    } catch (error: any) {
      console.error('Failed to save annotation:', error);
      alert(`Failed to save: ${error?.message || JSON.stringify(error)}`);
    }
  };

  const handleSaveDailyJournal = async (date: string, data: {
    market_context: string;
    execution_review: string;
  }) => {
    try {
      const journal = {
        date,
        account_index: 132275,
        market_context: data.market_context || null,
        execution_review: data.execution_review || null,
        updated_at: new Date().toISOString()
      };

      const upsertData = user ? { ...journal, user_id: user.id } : journal;
      const { error } = await supabase
        .from('daily_journals')
        .upsert(upsertData, {
          onConflict: user ? 'user_id,date' : 'date,account_index'
        });

      if (error) throw error;

      setDailyJournals(prev => new Map(prev).set(date, journal));
      setEditingDailyJournal(null);
    } catch (error: any) {
      console.error('Failed to save daily journal:', error);
      alert(`Failed to save: ${error?.message || JSON.stringify(error)}`);
    }
  };

  const handleSaveWeeklyJournal = async (weekStart: string, weekEnd: string, data: {
    market_overview: string;
    performance_review: string;
  }) => {
    try {
      const journal = {
        week_start: weekStart,
        week_end: weekEnd,
        account_index: 132275,
        market_overview: data.market_overview || null,
        performance_review: data.performance_review || null,
        updated_at: new Date().toISOString()
      };

      const upsertData = user ? { ...journal, user_id: user.id } : journal;
      const { error } = await supabase
        .from('weekly_journals')
        .upsert(upsertData, {
          onConflict: user ? 'user_id,week_start' : 'week_start,account_index'
        });

      if (error) throw error;

      setWeeklyJournals(prev => new Map(prev).set(weekStart, journal));
      setEditingWeeklyJournal(null);
    } catch (error: any) {
      console.error('Failed to save weekly journal:', error);
      alert(`Failed to save: ${error?.message || JSON.stringify(error)}`);
    }
  };

  const togglePositionExpanded = (positionId: string) => {
    setExpandedPositionId(expandedPositionId === positionId ? null : positionId);
  };

  const toggleDayExpanded = (date: string) => {
    setExpandedDays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(date)) {
        newSet.delete(date);
      } else {
        newSet.add(date);
      }
      return newSet;
    });
  };

  const toggleWeekExpanded = (weekStart: string) => {
    setExpandedWeeks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(weekStart)) {
        newSet.delete(weekStart);
      } else {
        newSet.add(weekStart);
      }
      return newSet;
    });
  };

  const expandAllDays = () => {
    setExpandedDays(new Set(filteredDayGroups.map(g => g.date)));
    setExpandedWeeks(new Set(weekGroups.map(w => w.weekStart)));
  };

  const collapseAllDays = () => {
    setExpandedDays(new Set());
    setExpandedWeeks(new Set());
  };

  const jumpToToday = () => {
    // Get today's date in DD/MM/YYYY format
    const now = new Date();
    const todayKey = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

    // Set the date filter to today only
    setFilters(f => ({ ...f, dateFilter: 'today' }));

    // Find the week containing today (using unfiltered weekGroups won't work after filter, so we calculate it)
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const weekStartKey = `${monday.getDate().toString().padStart(2, '0')}/${(monday.getMonth() + 1).toString().padStart(2, '0')}/${monday.getFullYear()}`;

    // Expand current week and today
    setExpandedWeeks(new Set([weekStartKey]));
    setExpandedDays(new Set([todayKey]));
  };

  if (loading) {
    return <div className="loading">Loading aggregated positions...</div>;
  }

  const closedPositions = positions.filter(p => p.is_closed);
  const openPositions = positions.filter(p => !p.is_closed);
  // Include realized PnL from open positions (partial closes)
  const closedPnL = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
  const openRealizedPnL = openPositions.reduce((sum, p) => sum + (p.realized_pnl || 0), 0);
  const totalPnL = closedPnL + openRealizedPnL;

  return (
    <div className="aggregated-positions-container">
      <div className="header-section">
        <h2>Aggregated Positions</h2>
        <div className="summary-stats">
          <div className="stat-card">
            <div className="stat-label">Total Positions</div>
            <div className="stat-value">{positions.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Closed</div>
            <div className="stat-value">{closedPositions.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Open</div>
            <div className="stat-value">{openPositions.length}</div>
          </div>
          <div className={`stat-card ${(totalPnL + (balanceData?.unrealized_pnl || 0) - feesExpenses) >= 0 ? 'positive' : 'negative'}`}>
            <div className="stat-label">Net PnL</div>
            <div className="stat-value">${Math.round(totalPnL + (balanceData?.unrealized_pnl || 0) - feesExpenses).toLocaleString()}</div>
          </div>
        </div>
        <div className="day-controls">
          <button onClick={jumpToToday} className={`control-btn today-btn ${filters.dateFilter === 'today' ? 'active' : ''}`}>Today</button>
          <button onClick={expandAllDays} className="control-btn">Expand All Days</button>
          <button onClick={collapseAllDays} className="control-btn">Collapse All Days</button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`control-btn filter-toggle ${showFilters ? 'active' : ''} ${hasActiveFilters ? 'has-filters' : ''}`}
          >
            {showFilters ? 'Hide Filters' : 'Show Filters'} {hasActiveFilters && `(${Object.values(filters).filter(v => v !== 'all' && v !== '').length})`}
          </button>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="control-btn clear-filters">Clear Filters</button>
          )}
        </div>

        {showFilters && (
          <div className="filters-section">
            <div className="filter-group">
              <label>PnL</label>
              <select
                value={filters.pnlFilter}
                onChange={(e) => setFilters(f => ({ ...f, pnlFilter: e.target.value as 'all' | 'positive' | 'negative' }))}
              >
                <option value="all">All</option>
                <option value="positive">Profitable</option>
                <option value="negative">Losing</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Side</label>
              <select
                value={filters.sideFilter}
                onChange={(e) => setFilters(f => ({ ...f, sideFilter: e.target.value as 'all' | 'long' | 'short' }))}
              >
                <option value="all">All</option>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Market</label>
              <select
                value={filters.marketFilter}
                onChange={(e) => setFilters(f => ({ ...f, marketFilter: e.target.value }))}
              >
                <option value="">All Markets</option>
                {uniqueMarkets.map(market => (
                  <option key={market} value={market}>{market}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>Category</label>
              <select
                value={filters.categoryFilter}
                onChange={(e) => setFilters(f => ({ ...f, categoryFilter: e.target.value }))}
              >
                <option value="">All Categories</option>
                {categories.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label>Timeframe</label>
              <select
                value={filters.timeframeFilter}
                onChange={(e) => setFilters(f => ({ ...f, timeframeFilter: e.target.value }))}
              >
                <option value="">All Timeframes</option>
                {timeframes.map(tf => (
                  <option key={tf.value} value={tf.value}>{tf.label}</option>
                ))}
              </select>
            </div>

            {uniqueSetups.length > 0 && (
              <div className="filter-group">
                <label>Setup</label>
                <select
                  value={filters.setupFilter}
                  onChange={(e) => setFilters(f => ({ ...f, setupFilter: e.target.value }))}
                >
                  <option value="">All Setups</option>
                  {uniqueSetups.map(setup => (
                    <option key={setup} value={setup}>{setup}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {hasActiveFilters && (
          <div className="filter-results">
            Showing {filteredDayGroups.filter(d => d.positions.length > 0).length} days with {filteredDayGroups.reduce((sum, d) => sum + d.positions.length, 0)} positions
          </div>
        )}
      </div>

      <div className="weeks-list">
        {weekGroups.map((weekGroup) => {
          const isWeekExpanded = expandedWeeks.has(weekGroup.weekStart);
          const weekJournal = weeklyJournals.get(weekGroup.weekStart);

          return (
            <div key={weekGroup.weekStart} className="week-group">
              {/* Week Header */}
              <div
                className="week-header"
                onClick={() => toggleWeekExpanded(weekGroup.weekStart)}
              >
                <div className="week-info">
                  <span className="expand-icon">{isWeekExpanded ? '▼' : '▶'}</span>
                  <span className="week-icon">📅</span>
                  <span className="week-date">Week of {weekGroup.displayWeek}</span>
                  <span className="week-stats">
                    {weekGroup.days.filter(d => d.positions.length > 0).length} day{weekGroup.days.filter(d => d.positions.length > 0).length !== 1 ? 's' : ''} traded · {weekGroup.totalPositions} position{weekGroup.totalPositions !== 1 ? 's' : ''}
                  </span>
                  {weekJournal?.rating && (
                    <span className="week-rating">
                      {'★'.repeat(weekJournal.rating)}{'☆'.repeat(5 - weekJournal.rating)}
                    </span>
                  )}
                </div>
                <div className={`week-pnl ${(weekGroup.weekPnL + (weekGroup.unrealizedPnL || 0)) >= 0 ? 'profit' : 'loss'}`}>
                  {weekGroup.isCurrentWeek && weekGroup.unrealizedPnL !== undefined && weekGroup.unrealizedPnL !== 0 ? (
                    (() => {
                      const totalPnL = weekGroup.weekPnL + weekGroup.unrealizedPnL;
                      const totalPct = weekGroup.prevWeekEndPortfolio !== 0
                        ? (totalPnL / weekGroup.prevWeekEndPortfolio) * 100
                        : 0;
                      return (
                        <>
                          <span>${Math.round(totalPnL).toLocaleString()}</span>
                          <span>{totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}%</span>
                        </>
                      );
                    })()
                  ) : (
                    <>
                      <span>${Math.round(weekGroup.weekPnL).toLocaleString()}</span>
                      <span>{weekGroup.weekPnLPercent >= 0 ? '+' : ''}{weekGroup.weekPnLPercent.toFixed(2)}%</span>
                    </>
                  )}
                </div>
              </div>

              {isWeekExpanded && (
                <>
                  {/* Weekly Journal Section */}
                  <div className="weekly-journal-section">
                    {editingWeeklyJournal === weekGroup.weekStart ? (
                      <div className="weekly-journal-editor" data-week={weekGroup.weekStart}>
                        <div className="journal-header-row">
                          <span className="journal-icon">📊</span>
                          <span className="journal-title">Weekly Review</span>
                        </div>
                        <div className="editor-field">
                          <label>Market Context</label>
                          <textarea
                            className="market-overview-input"
                            defaultValue={weekJournal?.market_overview || ''}
                            placeholder="What was the market like this week? Trends, volatility, key events..."
                            rows={2}
                          />
                        </div>
                        <div className="editor-field">
                          <label>Week Reflection</label>
                          <textarea
                            className="performance-review-input"
                            defaultValue={weekJournal?.performance_review || ''}
                            placeholder="How did I perform? What did I learn? What to focus on next?"
                            rows={3}
                          />
                        </div>
                        <div className="journal-actions">
                          <button
                            className="save-btn"
                            onClick={() => {
                              const editor = document.querySelector(`.weekly-journal-editor[data-week="${weekGroup.weekStart}"]`);
                              if (editor) {
                                handleSaveWeeklyJournal(weekGroup.weekStart, weekGroup.weekEnd, {
                                  market_overview: (editor.querySelector('.market-overview-input') as HTMLTextAreaElement)?.value || '',
                                  performance_review: (editor.querySelector('.performance-review-input') as HTMLTextAreaElement)?.value || ''
                                });
                              }
                            }}
                          >
                            Save Weekly Review
                          </button>
                          <button
                            className="cancel-btn"
                            onClick={() => setEditingWeeklyJournal(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="weekly-journal-display" onClick={() => setEditingWeeklyJournal(weekGroup.weekStart)}>
                        <div className="journal-header-row">
                          <span className="journal-icon">📊</span>
                          <span className="journal-title">Weekly Review</span>
                          <button className="edit-journal-btn" onClick={(e) => { e.stopPropagation(); setEditingWeeklyJournal(weekGroup.weekStart); }}>Edit</button>
                        </div>
                        {weekJournal && (
                          weekJournal.market_overview ||
                          weekJournal.performance_review
                        ) ? (
                          <div className="journal-content weekly-content">
                            {weekJournal?.market_overview && (
                              <div className="journal-field">
                                <span className="field-label">Market:</span>
                                <span className="field-text">{weekJournal.market_overview}</span>
                              </div>
                            )}
                            {weekJournal?.performance_review && (
                              <div className="journal-field">
                                <span className="field-label">Reflection:</span>
                                <span className="field-text">{weekJournal.performance_review}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="journal-placeholder">
                            Click to add a weekly review...
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Days within the week */}
                  <div className="days-list">
                    {weekGroup.days.map((dayGroup) => {
                      const isDayExpanded = expandedDays.has(dayGroup.date);
                      const isEmpty = dayGroup.positions.length === 0;

                      return (
                        <div key={dayGroup.date} className={`day-group ${isEmpty ? 'empty-day' : ''}`}>
                          <div
                            className="day-header"
                            onClick={() => !isEmpty && toggleDayExpanded(dayGroup.date)}
                          >
                            <div className="day-info">
                              {!isEmpty && <span className="expand-icon">{isDayExpanded ? '▼' : '▶'}</span>}
                              <span className="day-date">{dayGroup.displayDate}</span>
                              {isEmpty ? (
                                <span className="day-count no-trades">No trades</span>
                              ) : (
                                <span className="day-count">{dayGroup.positions.length} position{dayGroup.positions.length !== 1 ? 's' : ''}</span>
                              )}
                            </div>
                            {!isEmpty && (
                              <div className={`day-pnl ${(dayGroup.dayPnL + (dayGroup.unrealizedPnL || 0)) >= 0 ? 'profit' : 'loss'}`}>
                                {dayGroup.isToday && dayGroup.unrealizedPnL !== undefined && dayGroup.unrealizedPnL !== 0 ? (
                                  <>
                                    <span>${Math.round(dayGroup.dayPnL + dayGroup.unrealizedPnL).toLocaleString()}</span>
                                    <span>{dayGroup.dayPnLPercent >= 0 ? '+' : ''}{dayGroup.dayPnLPercent.toFixed(2)}%</span>
                                  </>
                                ) : (
                                  <>
                                    <span>${Math.round(dayGroup.dayPnL).toLocaleString()}</span>
                                    <span>{dayGroup.dayPnLPercent >= 0 ? '+' : ''}{dayGroup.dayPnLPercent.toFixed(2)}%</span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>

              {isDayExpanded && (
                <>
                  {/* Daily Journal Section */}
                  <div className="daily-journal-section">
                    {editingDailyJournal === dayGroup.date ? (
                      <div className="daily-journal-editor" data-date={dayGroup.date}>
                        <div className="journal-header-row">
                          <span className="journal-icon">📓</span>
                          <span className="journal-title">Daily Journal</span>
                        </div>
                        <div className="editor-field">
                          <label>Market Context</label>
                          <textarea
                            className="market-context-input"
                            defaultValue={dailyJournals.get(dayGroup.date)?.market_context || ''}
                            placeholder="What was happening in the market? Key levels, trends, news..."
                            rows={2}
                          />
                        </div>
                        <div className="editor-field">
                          <label>Trades Reflection</label>
                          <textarea
                            className="trades-reflection-input"
                            defaultValue={dailyJournals.get(dayGroup.date)?.execution_review || ''}
                            placeholder="How did my trades go? What did I learn? What to improve?"
                            rows={3}
                          />
                        </div>
                        <div className="journal-actions">
                          <button
                            className="save-btn"
                            onClick={() => {
                              const editor = document.querySelector(`.daily-journal-editor[data-date="${dayGroup.date}"]`);
                              if (editor) {
                                handleSaveDailyJournal(dayGroup.date, {
                                  market_context: (editor.querySelector('.market-context-input') as HTMLTextAreaElement)?.value || '',
                                  execution_review: (editor.querySelector('.trades-reflection-input') as HTMLTextAreaElement)?.value || ''
                                });
                              }
                            }}
                          >
                            Save Journal
                          </button>
                          <button
                            className="cancel-btn"
                            onClick={() => setEditingDailyJournal(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="daily-journal-display" onClick={() => setEditingDailyJournal(dayGroup.date)}>
                        <div className="journal-header-row">
                          <span className="journal-icon">📓</span>
                          <span className="journal-title">Daily Journal</span>
                          <button className="edit-journal-btn" onClick={(e) => { e.stopPropagation(); setEditingDailyJournal(dayGroup.date); }}>Edit</button>
                        </div>
                        {dailyJournals.get(dayGroup.date) && (
                          dailyJournals.get(dayGroup.date)!.market_context ||
                          dailyJournals.get(dayGroup.date)!.execution_review
                        ) ? (
                          <div className="journal-content">
                            {dailyJournals.get(dayGroup.date)?.market_context && (
                              <div className="journal-field">
                                <span className="field-label">Market:</span>
                                <span className="field-text">{dailyJournals.get(dayGroup.date)!.market_context}</span>
                              </div>
                            )}
                            {dailyJournals.get(dayGroup.date)?.execution_review && (
                              <div className="journal-field">
                                <span className="field-label">Reflection:</span>
                                <span className="field-text">{dailyJournals.get(dayGroup.date)!.execution_review}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="journal-placeholder">
                            Click to add a daily journal entry...
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isMobile ? (
                    <div className="mob-positions">
                      {dayGroup.positions.map((position) => {
                        const annotation = annotations.get(position.position_id);
                        const isExpanded = expandedPositionId === position.position_id;
                        const isEditing = editingPositionId === position.position_id;
                        const realizedPnl = position.is_closed ? position.pnl : (position.realized_pnl || 0);
                        const hasRealizedPnl = realizedPnl !== null && realizedPnl !== 0;
                        const balancePosition = !position.is_closed
                          ? balanceData?.positions?.find(bp => bp.symbol === position.market_symbol)
                          : undefined;
                        const unrealizedPnl = balancePosition ? parseFloat(balancePosition.unrealized_pnl) : null;
                        const pnlClass = !position.is_closed ? 'open-position' : (hasRealizedPnl && realizedPnl >= 0 ? 'positive' : 'negative');
                        const cardClass = !position.is_closed ? 'open-pos' : (hasRealizedPnl && realizedPnl >= 0 ? 'profit' : 'loss');

                        return (
                          <div key={position.position_id} className={`mob-pos ${cardClass}`} onClick={() => togglePositionExpanded(position.position_id)}>
                            <div className="mob-pos-header">
                              <span className={`type ${position.position_type.toLowerCase()}`}>
                                {position.position_type}
                              </span>
                              <span className="mob-pos-symbol">{position.market_symbol}</span>
                              <span className={`mob-pos-pnl ${pnlClass}`}>
                                {hasRealizedPnl ? `$${Math.round(realizedPnl!).toLocaleString()}` : '—'}
                              </span>
                            </div>
                            <div className="mob-pos-date">
                              {position.entry_date}{position.exit_date ? ` → ${position.exit_date}` : ' (Open)'}
                            </div>
                            <div className="mob-pos-details">
                              <div className="mob-pos-row">
                                <span>Size</span>
                                <span>{(position.max_position_size ?? position.total_size ?? 0).toFixed(4)}</span>
                              </div>
                              <div className="mob-pos-row">
                                <span>Entry</span>
                                <span>${position.avg_entry_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>
                              <div className="mob-pos-row">
                                <span>Exit</span>
                                <span>{position.avg_exit_price ? `$${position.avg_exit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span>
                              </div>
                              {unrealizedPnl !== null && unrealizedPnl !== 0 && (
                                <div className="mob-pos-row">
                                  <span>uPnL</span>
                                  <span style={{ color: unrealizedPnl >= 0 ? '#10b981' : '#dc2626', fontWeight: 600 }}>
                                    ${Math.round(unrealizedPnl).toLocaleString()}
                                  </span>
                                </div>
                              )}
                              {position.total_funding !== undefined && position.total_funding !== 0 && (
                                <div className="mob-pos-row">
                                  <span>Funding</span>
                                  <span style={{ color: position.total_funding >= 0 ? '#10b981' : '#dc2626', fontWeight: 600 }}>
                                    ${Math.round(position.total_funding).toLocaleString()}
                                  </span>
                                </div>
                              )}
                              <div className="mob-pos-row">
                                <span>Trades</span>
                                <span>{position.trades?.length || position.trade_count || 0}</span>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="mob-pos-expanded" onClick={(e) => e.stopPropagation()}>
                                {/* Journal section */}
                                <div className="mob-pos-journal">
                                  {isEditing ? (
                                    <div className="journal-editor" data-position-id={position.position_id}>
                                      <div className="editor-row three-col">
                                        <div className="editor-field">
                                          <label>Category</label>
                                          <select className="category-select" defaultValue={annotation?.category || ''}>
                                            <option value="">Select...</option>
                                            {categories.map(cat => (
                                              <option key={cat.value} value={cat.value}>{cat.label}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div className="editor-field">
                                          <label>Timeframe</label>
                                          <select className="timeframe-select" defaultValue={annotation?.timeframe || ''}>
                                            <option value="">Select...</option>
                                            {timeframes.map(tf => (
                                              <option key={tf.value} value={tf.value}>{tf.label}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div className="editor-field">
                                          <label>Setup/Pattern</label>
                                          <input type="text" className="subcategory-input" defaultValue={annotation?.subcategory || ''} placeholder="e.g., Monday Range..." />
                                        </div>
                                      </div>
                                      <div className="editor-row">
                                        <div className="editor-field">
                                          <label>What went well?</label>
                                          <textarea className="did-well-input" defaultValue={annotation?.did_well || ''} placeholder="Good entries, patience..." rows={2} />
                                        </div>
                                        <div className="editor-field">
                                          <label>Possible improvements</label>
                                          <textarea className="could-improve-input" defaultValue={annotation?.could_improve || ''} placeholder="Sizing, entry timing..." rows={2} />
                                        </div>
                                      </div>
                                      <div className="editor-field">
                                        <label>Emotions</label>
                                        <div className="emotions-chips">
                                          {emotionOptions.map(emotion => {
                                            const currentEmotions = (annotation?.emotions || '').split(',').map(e => e.trim()).filter(Boolean);
                                            const isSelected = currentEmotions.includes(emotion);
                                            return (
                                              <button key={emotion} type="button" className={`emotion-chip ${isSelected ? 'selected' : ''}`}
                                                onClick={(e) => {
                                                  const editor = e.currentTarget.closest('.journal-editor');
                                                  const hiddenInput = editor?.querySelector('.emotions-hidden') as HTMLInputElement;
                                                  if (hiddenInput) {
                                                    const current = hiddenInput.value.split(',').map(s => s.trim()).filter(Boolean);
                                                    if (current.includes(emotion)) {
                                                      hiddenInput.value = current.filter(e => e !== emotion).join(', ');
                                                    } else {
                                                      hiddenInput.value = [...current, emotion].join(', ');
                                                    }
                                                    e.currentTarget.classList.toggle('selected');
                                                  }
                                                }}
                                              >
                                                {emotion}
                                              </button>
                                            );
                                          })}
                                          <input type="hidden" className="emotions-hidden" defaultValue={annotation?.emotions || ''} />
                                        </div>
                                      </div>
                                      <div className="journal-actions">
                                        <button className="save-btn" onClick={() => {
                                          const editor = document.querySelector(`.journal-editor[data-position-id="${position.position_id}"]`);
                                          if (editor) {
                                            handleSaveAnnotation(position.position_id, {
                                              category: (editor.querySelector('.category-select') as HTMLSelectElement)?.value || '',
                                              timeframe: (editor.querySelector('.timeframe-select') as HTMLSelectElement)?.value || '',
                                              subcategory: (editor.querySelector('.subcategory-input') as HTMLInputElement)?.value || '',
                                              did_well: (editor.querySelector('.did-well-input') as HTMLTextAreaElement)?.value || '',
                                              could_improve: (editor.querySelector('.could-improve-input') as HTMLTextAreaElement)?.value || '',
                                              emotions: (editor.querySelector('.emotions-hidden') as HTMLInputElement)?.value || ''
                                            });
                                          }
                                        }}>Save</button>
                                        <button className="cancel-btn" onClick={() => setEditingPositionId(null)}>Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="annotation-tags">
                                        {annotation?.timeframe && (
                                          <span className={`timeframe-badge ${annotation.timeframe}`}>
                                            {timeframes.find(t => t.value === annotation.timeframe)?.label || annotation.timeframe}
                                          </span>
                                        )}
                                        {annotation?.category && (
                                          <span className={`category-badge ${annotation.category}`}>
                                            {categories.find(c => c.value === annotation.category)?.label || annotation.category}
                                          </span>
                                        )}
                                        {annotation?.subcategory && <span className="subcategory-badge">{annotation.subcategory}</span>}
                                        {annotation?.emotions && <span className="emotions-badge">{annotation.emotions}</span>}
                                      </div>
                                      {annotation?.did_well || annotation?.could_improve ? (
                                        <div className="journal-notes">
                                          {annotation?.did_well && (
                                            <div className="note-section positive">
                                              <span className="note-label">Did well:</span>
                                              <span className="note-text">{annotation.did_well}</span>
                                            </div>
                                          )}
                                          {annotation?.could_improve && (
                                            <div className="note-section negative">
                                              <span className="note-label">Improve:</span>
                                              <span className="note-text">{annotation.could_improve}</span>
                                            </div>
                                          )}
                                        </div>
                                      ) : null}
                                      <div className="mob-pos-actions">
                                        <button onClick={() => setEditingPositionId(position.position_id)}>Edit Journal</button>
                                      </div>
                                    </>
                                  )}
                                </div>

                                {/* Trade fills */}
                                {position.trades && position.trades.length > 0 && (
                                  <div className="mob-pos-fills">
                                    <h4>Trade Fills ({position.trades.length})</h4>
                                    {[...position.trades].reverse().map((trade) => (
                                      <div key={trade.trade_id} className="mob-pos-fill">
                                        <span className={`mob-fill-side ${trade.side.toLowerCase()}`}>{trade.side}</span>
                                        <span className="mob-fill-info">{trade.size.toFixed(4)} @ ${trade.price.toFixed(2)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                  <div className="positions-list">
                    {dayGroup.positions.map((position) => {
                    const annotation = annotations.get(position.position_id);
                    const isExpanded = expandedPositionId === position.position_id;
                    const isEditing = editingPositionId === position.position_id;

                    return (
                      <div key={position.position_id} className={`position-card ${position.is_closed ? 'closed' : 'open'} ${position.pnl !== null && position.pnl >= 0 ? 'profit' : 'loss'}`}>
                        <div className="position-header" onClick={() => togglePositionExpanded(position.position_id)}>
                          <div className="position-info">
                            <div className="position-type-badge">
                              <span className={`type ${position.position_type.toLowerCase()}`}>
                                {position.position_type}
                              </span>
                              <span className="size">{(position.max_position_size ?? position.total_size ?? 0).toFixed(4)} {position.market_symbol}</span>
                            </div>
                            <div className="position-dates">
                              <span>Entry: {position.entry_date}</span>
                              {position.exit_date && <span>Exit: {position.exit_date}</span>}
                            </div>
                          </div>
                          <div className="position-metrics">
                            <div className="metric">
                              <span className="label">Avg Entry:</span>
                              <span className="value">${position.avg_entry_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div className="metric">
                              <span className="label">Avg Exit:</span>
                              <span className="value">{position.avg_exit_price ? `$${position.avg_exit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span>
                            </div>
                            {(() => {
                              // For closed positions, show full PnL; for open positions, show realized_pnl from partial closes
                              const realizedPnl = position.is_closed ? position.pnl : (position.realized_pnl || 0);
                              const hasRealizedPnl = realizedPnl !== null && realizedPnl !== 0;
                              return (
                                <div className={`metric pnl ${hasRealizedPnl ? (realizedPnl >= 0 ? 'profit' : 'loss') : ''}`}>
                                  <span className="label">PnL:</span>
                                  <span className="value">
                                    {hasRealizedPnl ? `$${Math.round(realizedPnl).toLocaleString()}` : '—'}
                                  </span>
                                </div>
                              );
                            })()}
                            {(() => {
                              // Only show uPnL for open positions - closed positions have fully realized P&L
                              const balancePosition = !position.is_closed
                                ? balanceData?.positions?.find(bp => bp.symbol === position.market_symbol)
                                : undefined;
                              const unrealizedPnl = balancePosition ? parseFloat(balancePosition.unrealized_pnl) : null;
                              return (
                                <div className={`metric upnl ${unrealizedPnl !== null && unrealizedPnl !== 0 ? (unrealizedPnl >= 0 ? 'profit' : 'loss') : ''}`}>
                                  <span className="label">uPnL:</span>
                                  <span className="value">
                                    {unrealizedPnl !== null && unrealizedPnl !== 0 ? `$${Math.round(unrealizedPnl).toLocaleString()}` : '—'}
                                  </span>
                                </div>
                              );
                            })()}
                            {(() => {
                              const funding = position.total_funding || 0;
                              const hasFunding = funding !== 0;
                              return (
                                <div className={`metric funding ${hasFunding ? (funding >= 0 ? 'profit' : 'loss') : ''}`}>
                                  <span className="label">Funding:</span>
                                  <span className="value">
                                    {hasFunding ? `$${Math.round(funding).toLocaleString()}` : '—'}
                                  </span>
                                </div>
                              );
                            })()}
                            <div className="metric">
                              <span className="label">Trades:</span>
                              <span className="value">{position.trades?.length || position.trade_count || 0}</span>
                            </div>
                          </div>
                          <div className="expand-icon">{isExpanded ? '▼' : '▶'}</div>
                        </div>

                        {isExpanded && (
                          <div className="position-details">
                            <div className="journal-section">
                              <h4>Journal Notes</h4>
                              {isEditing ? (
                                <div className="journal-editor" data-position-id={position.position_id}>
                                  <div className="editor-row three-col">
                                    <div className="editor-field">
                                      <label>Category</label>
                                      <select
                                        className="category-select"
                                        defaultValue={annotation?.category || ''}
                                      >
                                        <option value="">Select...</option>
                                        {categories.map(cat => (
                                          <option key={cat.value} value={cat.value} title={cat.description}>
                                            {cat.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="editor-field">
                                      <label>Timeframe</label>
                                      <select
                                        className="timeframe-select"
                                        defaultValue={annotation?.timeframe || ''}
                                      >
                                        <option value="">Select...</option>
                                        {timeframes.map(tf => (
                                          <option key={tf.value} value={tf.value}>{tf.label}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="editor-field">
                                      <label>Setup/Pattern</label>
                                      <input
                                        type="text"
                                        className="subcategory-input"
                                        defaultValue={annotation?.subcategory || ''}
                                        placeholder="e.g., Monday Range..."
                                      />
                                    </div>
                                  </div>

                                  <div className="editor-row">
                                    <div className="editor-field">
                                      <label>What went well?</label>
                                      <textarea
                                        className="did-well-input"
                                        defaultValue={annotation?.did_well || ''}
                                        placeholder="Good entries, patience, followed plan..."
                                        rows={2}
                                      />
                                    </div>
                                    <div className="editor-field">
                                      <label>Possible improvements</label>
                                      <textarea
                                        className="could-improve-input"
                                        defaultValue={annotation?.could_improve || ''}
                                        placeholder="Sizing, entry timing, exit strategy..."
                                        rows={2}
                                      />
                                    </div>
                                  </div>

                                  <div className="editor-field">
                                    <label>Emotions</label>
                                    <div className="emotions-chips">
                                      {emotionOptions.map(emotion => {
                                        const currentEmotions = (annotation?.emotions || '').split(',').map(e => e.trim()).filter(Boolean);
                                        const isSelected = currentEmotions.includes(emotion);
                                        return (
                                          <button
                                            key={emotion}
                                            type="button"
                                            className={`emotion-chip ${isSelected ? 'selected' : ''}`}
                                            onClick={(e) => {
                                              const editor = e.currentTarget.closest('.journal-editor');
                                              const hiddenInput = editor?.querySelector('.emotions-hidden') as HTMLInputElement;
                                              if (hiddenInput) {
                                                const current = hiddenInput.value.split(',').map(s => s.trim()).filter(Boolean);
                                                if (current.includes(emotion)) {
                                                  hiddenInput.value = current.filter(e => e !== emotion).join(', ');
                                                } else {
                                                  hiddenInput.value = [...current, emotion].join(', ');
                                                }
                                                // Toggle visual state
                                                e.currentTarget.classList.toggle('selected');
                                              }
                                            }}
                                          >
                                            {emotion}
                                          </button>
                                        );
                                      })}
                                      <input
                                        type="hidden"
                                        className="emotions-hidden"
                                        defaultValue={annotation?.emotions || ''}
                                      />
                                    </div>
                                  </div>

                                  <div className="journal-actions">
                                    <button
                                      className="save-btn"
                                      onClick={() => {
                                        const editor = document.querySelector(`.journal-editor[data-position-id="${position.position_id}"]`);
                                        if (editor) {
                                          handleSaveAnnotation(position.position_id, {
                                            category: (editor.querySelector('.category-select') as HTMLSelectElement)?.value || '',
                                            timeframe: (editor.querySelector('.timeframe-select') as HTMLSelectElement)?.value || '',
                                            subcategory: (editor.querySelector('.subcategory-input') as HTMLInputElement)?.value || '',
                                            did_well: (editor.querySelector('.did-well-input') as HTMLTextAreaElement)?.value || '',
                                            could_improve: (editor.querySelector('.could-improve-input') as HTMLTextAreaElement)?.value || '',
                                            emotions: (editor.querySelector('.emotions-hidden') as HTMLInputElement)?.value || ''
                                          });
                                        }
                                      }}
                                    >
                                      Save
                                    </button>
                                    <button
                                      className="cancel-btn"
                                      onClick={() => setEditingPositionId(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="journal-display" onClick={() => setEditingPositionId(position.position_id)}>
                                  <div className="annotation-tags">
                                    {annotation?.timeframe && (
                                      <span className={`timeframe-badge ${annotation.timeframe}`}>
                                        {timeframes.find(t => t.value === annotation.timeframe)?.label || annotation.timeframe}
                                      </span>
                                    )}
                                    {annotation?.category && (
                                      <span className={`category-badge ${annotation.category}`}>
                                        {categories.find(c => c.value === annotation.category)?.label || annotation.category}
                                      </span>
                                    )}
                                    {annotation?.subcategory && (
                                      <span className="subcategory-badge">{annotation.subcategory}</span>
                                    )}
                                    {annotation?.emotions && (
                                      <span className="emotions-badge">{annotation.emotions}</span>
                                    )}
                                  </div>

                                  {annotation?.did_well || annotation?.could_improve ? (
                                    <div className="journal-notes">
                                      {annotation?.did_well && (
                                        <div className="note-section positive">
                                          <span className="note-label">Did well:</span>
                                          <span className="note-text">{annotation.did_well}</span>
                                        </div>
                                      )}
                                      {annotation?.could_improve && (
                                        <div className="note-section negative">
                                          <span className="note-label">Improve:</span>
                                          <span className="note-text">{annotation.could_improve}</span>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="journal-text">
                                      Click to add notes about this position...
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="trades-section">
                              <h4>Trade Breakdown ({position.trades?.length || position.trade_count || 0} trades)</h4>
                              {position.trades && position.trades.length > 0 ? (
                              <table className="trades-breakdown">
                                <thead>
                                  <tr>
                                    <th>Time</th>
                                    <th>Side</th>
                                    <th>Size</th>
                                    <th>Price</th>
                                    <th>USD Amount</th>
                                    <th>Fees</th>
                                    <th>Position Before</th>
                                    <th>Position After</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...position.trades].reverse().map((trade) => (
                                    <tr key={trade.trade_id} className={trade.side.toLowerCase()}>
                                      <td className="time-cell">{trade.date_time}</td>
                                      <td>
                                        <span className={`side-badge ${trade.side.toLowerCase()}`}>
                                          {trade.side}
                                        </span>
                                      </td>
                                      <td className="number-cell">{trade.size.toFixed(4)}</td>
                                      <td className="number-cell">${trade.price.toFixed(2)}</td>
                                      <td className="number-cell">${trade.usd_amount.toFixed(2)}</td>
                                      <td className="number-cell fee-cell">{(trade.fee || 0) > 0.001 ? `$${(trade.fee || 0).toFixed(2)}` : '—'}</td>
                                      <td className="number-cell">{trade.position_before.toFixed(4)}</td>
                                      <td className="number-cell">{trade.position_after.toFixed(4)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              ) : (
                                <p style={{ color: '#6b7280', fontStyle: 'italic', margin: '0.5rem 0' }}>
                                  Trade details not available for synced positions.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                        })}
                    </div>
                  )}
                  </>
                )}
              </div>
            );
          })}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        .aggregated-positions-container {
          padding: 2rem;
          max-width: 1400px;
          margin: 0 auto;
        }

        .header-section {
          margin-bottom: 2rem;
        }

        .header-section h2 {
          margin: 0 0 1rem 0;
          color: #1a1a1a;
        }

        .summary-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .day-controls {
          display: flex;
          gap: 0.5rem;
        }

        .control-btn {
          padding: 0.5rem 1rem;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .control-btn:hover {
          background: #e5e7eb;
        }

        .control-btn.filter-toggle.active {
          background: #dbeafe;
          border-color: #93c5fd;
          color: #1d4ed8;
        }

        .control-btn.filter-toggle.has-filters {
          background: #fef3c7;
          border-color: #fcd34d;
          color: #92400e;
        }

        .control-btn.clear-filters {
          background: #fee2e2;
          border-color: #fca5a5;
          color: #dc2626;
        }

        .control-btn.clear-filters:hover {
          background: #fecaca;
        }

        .control-btn.today-btn {
          background: #f3f4f6;
          border-color: #5b8def;
          color: #5b8def;
          font-weight: 600;
        }

        .control-btn.today-btn:hover {
          background: #e8f0fe;
        }

        .control-btn.today-btn.active {
          background: #5b8def;
          border-color: #5b8def;
          color: white;
        }

        .control-btn.today-btn.active:hover {
          background: #4a7de0;
          border-color: #4a7de0;
        }

        .filters-section {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          padding: 1rem;
          background: white;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          margin-top: 1rem;
        }

        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          min-width: 140px;
        }

        .filter-group label {
          font-size: 0.75rem;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
        }

        .filter-group select {
          padding: 0.5rem;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          font-size: 0.9rem;
          background: white;
          cursor: pointer;
        }

        .filter-group select:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }

        .filter-results {
          padding: 0.75rem 1rem;
          background: #f0f9ff;
          border: 1px solid #bae6fd;
          border-radius: 6px;
          color: #0369a1;
          font-size: 0.9rem;
          margin-top: 1rem;
        }

        .stat-card {
          background: white;
          padding: 1rem;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .stat-card.positive {
          background: linear-gradient(135deg, #d1fae5 0%, white 100%);
        }

        .stat-card.negative {
          background: linear-gradient(135deg, #fee2e2 0%, white 100%);
        }

        .stat-label {
          font-size: 0.85rem;
          color: #666;
          margin-bottom: 0.5rem;
        }

        .stat-value {
          font-size: 1.5rem;
          font-weight: 600;
          color: #1a1a1a;
        }

        .days-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .day-group {
          background: white;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          overflow: hidden;
        }

        .day-group.empty-day {
          opacity: 0.6;
        }

        .day-group.empty-day .day-header {
          cursor: default;
          padding: 0.75rem 1.5rem;
        }

        .day-group.empty-day .day-header:hover {
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        }

        .day-count.no-trades {
          background: #f3f4f6;
          color: #9ca3af;
          font-style: italic;
        }

        .day-header {
          padding: 1rem 1.5rem;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          border-bottom: 1px solid #e2e8f0;
          transition: background 0.2s;
        }

        .day-header:hover {
          background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
        }

        .day-info {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .day-date {
          font-weight: 600;
          font-size: 1.1rem;
          color: #1e293b;
        }

        .day-count {
          font-size: 0.85rem;
          color: #64748b;
          background: #e2e8f0;
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
        }

        .day-pnl {
          display: flex;
          align-items: baseline;
          gap: 0.75rem;
          font-family: 'Gilroy', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          font-size: 1rem;
          font-weight: 700;
        }

        .day-pnl.profit {
          color: #10b981;
        }

        .day-pnl.loss {
          color: #dc2626;
        }

        .day-pnl .unrealized-indicator {
          font-size: 0.7rem;
          opacity: 0.7;
          cursor: help;
          margin-left: -0.3rem;
        }

        .positions-list {
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        .position-card {
          background: white;
          overflow: hidden;
          border-bottom: 1px solid #f1f5f9;
        }

        .position-card:last-child {
          border-bottom: none;
        }

        .position-card.closed.profit {
          border-left: 10px solid #10b981;
        }

        .position-card.closed.loss {
          border-left: 10px solid #dc2626;
        }

        .position-card.open {
          border-left: 10px solid #3b82f6;
        }

        .position-header {
          padding: 1.25rem 1.5rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          transition: background 0.2s;
        }

        .position-header:hover {
          background: #fafafa;
        }

        .position-info {
          flex: 1;
        }

        .position-type-badge {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .type {
          padding: 0.25rem 0.75rem;
          border-radius: 4px;
          font-weight: 600;
          font-size: 0.85rem;
        }

        .type.long {
          background: #d1fae5;
          color: #065f46;
        }

        .type.short {
          background: #fce7f3;
          color: #9f1239;
        }

        .size {
          font-weight: 600;
          color: #666;
        }

        .position-dates {
          display: flex;
          gap: 1.5rem;
          font-size: 0.85rem;
          color: #666;
        }

        .position-metrics {
          display: flex;
          gap: 1rem;
          align-items: flex-start;
        }

        .metric {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          min-width: 85px;
          text-align: right;
        }

        .metric.pnl {
          min-width: 85px;
        }

        .metric.upnl {
          min-width: 85px;
        }

        .metric.funding {
          min-width: 85px;
        }

        .metric .label {
          font-size: 0.75rem;
          color: #999;
          font-weight: 500;
        }

        .metric .value {
          font-weight: 600;
          font-family: monospace;
          font-size: 0.95rem;
        }

        .metric.pnl.profit .value,
        .metric.upnl.profit .value,
        .metric.funding.profit .value {
          color: #10b981;
        }

        .metric.pnl.loss .value,
        .metric.upnl.loss .value,
        .metric.funding.loss .value {
          color: #dc2626;
        }

        .expand-icon {
          color: #999;
          font-size: 0.9rem;
          margin-left: 1rem;
        }

        .position-details {
          border-top: 1px solid #e5e7eb;
          padding: 1.5rem;
          background: #fafafa;
        }

        .journal-section {
          margin-bottom: 2rem;
        }

        .journal-section h4 {
          margin: 0 0 1rem 0;
          color: #374151;
        }

        .journal-display {
          background: white;
          padding: 1rem;
          border-radius: 6px;
          min-height: 80px;
          cursor: pointer;
          transition: box-shadow 0.2s;
        }

        .journal-display:hover {
          box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }

        .annotation-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .timeframe-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 600;
        }

        .timeframe-badge.scalp {
          background: #fef3c7;
          color: #92400e;
        }

        .timeframe-badge.intraday {
          background: #dbeafe;
          color: #1e40af;
        }

        .timeframe-badge.swing {
          background: #f3e8ff;
          color: #6b21a8;
        }

        .category-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 600;
        }

        .category-badge.trend {
          background: #d1fae5;
          color: #065f46;
        }

        .category-badge.range {
          background: #e0e7ff;
          color: #3730a3;
        }

        .category-badge.breakout {
          background: #fee2e2;
          color: #991b1b;
        }

        .category-badge.reversal {
          background: #fce7f3;
          color: #9f1239;
        }

        .category-badge.event {
          background: #fef3c7;
          color: #92400e;
        }

        .subcategory-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          background: #f3f4f6;
          color: #374151;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 500;
        }

        .emotions-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          background: #fef9c3;
          color: #713f12;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 500;
        }

        .emotions-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .emotion-chip {
          padding: 0.375rem 0.75rem;
          border: 1px solid #e2e8f0;
          border-radius: 9999px;
          background: #f8fafc;
          color: #64748b;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .emotion-chip:hover {
          border-color: #cbd5e1;
          background: #f1f5f9;
        }

        .emotion-chip.selected {
          background: #fef9c3;
          border-color: #fde047;
          color: #713f12;
          font-weight: 500;
        }

        .journal-text {
          color: #666;
          font-style: italic;
          line-height: 1.6;
        }

        .journal-notes {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .note-section {
          display: flex;
          gap: 0.5rem;
          padding: 0.5rem 0;
          border-bottom: 1px solid #f3f4f6;
        }

        .note-section:last-child {
          border-bottom: none;
        }

        .note-section.positive .note-label {
          color: #059669;
        }

        .note-section.negative .note-label {
          color: #dc2626;
        }

        .note-label {
          font-weight: 600;
          font-size: 0.85rem;
          color: #6b7280;
          min-width: 70px;
          flex-shrink: 0;
        }

        .note-text {
          font-size: 0.9rem;
          color: #374151;
          line-height: 1.5;
        }

        .journal-editor {
          background: white;
          padding: 1.25rem;
          border-radius: 6px;
        }

        .editor-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          margin-bottom: 0;
        }

        .editor-row.three-col {
          grid-template-columns: 1fr 1fr 1.5fr;
        }

        .editor-field {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .editor-field:last-child {
          margin-bottom: 0;
        }

        .editor-field label {
          font-size: 0.85rem;
          font-weight: 600;
          color: #374151;
        }

        .category-select,
        .timeframe-select {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 0.9rem;
          background: white;
        }

        .subcategory-input,
        .emotions-input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 0.9rem;
          font-family: 'Gilroy', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          font-weight: 500;
        }

        .journal-textarea,
        .setup-thesis-input,
        .did-well-input,
        .could-improve-input,
        .other-notes-input,
        .market-context-input,
        .trades-reflection-input,
        .market-overview-input,
        .performance-review-input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 0.9rem;
          font-family: 'Gilroy', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          font-weight: 500;
          resize: vertical;
        }

        .journal-actions {
          display: flex;
          gap: 0.75rem;
          margin-top: 1rem;
        }

        .save-btn, .cancel-btn {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 4px;
          font-size: 0.9rem;
          cursor: pointer;
          transition: background 0.2s;
        }

        .save-btn {
          background: #10b981;
          color: white;
        }

        .save-btn:hover {
          background: #059669;
        }

        .cancel-btn {
          background: #e5e7eb;
          color: #374151;
        }

        .cancel-btn:hover {
          background: #d1d5db;
        }

        .trades-section h4 {
          margin: 0 0 1rem 0;
          color: #374151;
        }

        .trades-breakdown {
          width: 100%;
          background: white;
          border-radius: 6px;
          overflow: hidden;
          font-size: 0.85rem;
        }

        .trades-breakdown thead {
          background: #f3f4f6;
        }

        .trades-breakdown th {
          padding: 0.75rem;
          text-align: left;
          font-weight: 600;
          color: #374151;
        }

        .trades-breakdown td {
          padding: 0.75rem;
          border-bottom: 1px solid #f3f4f6;
        }

        .trades-breakdown tbody tr.buy {
          border-left: 3px solid #10b981;
        }

        .trades-breakdown tbody tr.sell {
          border-left: 3px solid #dc2626;
        }

        .time-cell {
          font-family: monospace;
          font-size: 0.8rem;
          color: #666;
        }

        .number-cell {
          text-align: right;
          font-family: monospace;
        }

        .side-badge {
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-weight: 600;
          font-size: 0.75rem;
        }

        .side-badge.buy {
          background: #d1fae5;
          color: #065f46;
        }

        .side-badge.sell {
          background: #fee2e2;
          color: #991b1b;
        }

        .loading {
          padding: 3rem;
          text-align: center;
          color: #666;
        }

        /* Daily Journal Styles */
        .daily-journal-section {
          border-bottom: 1px solid #e2e8f0;
          background: #fefefe;
        }

        .daily-journal-display {
          padding: 1rem 1.5rem;
          cursor: pointer;
          transition: background 0.2s;
        }

        .daily-journal-display:hover {
          background: #f8fafc;
        }

        .daily-journal-editor {
          padding: 1.25rem 1.5rem;
          background: #f8fafc;
        }

        .journal-header-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.75rem;
        }

        .journal-icon {
          font-size: 1.1rem;
        }

        .journal-title {
          font-weight: 600;
          color: #374151;
          font-size: 0.95rem;
        }

        .journal-rating {
          color: #f59e0b;
          font-size: 1rem;
          margin-left: 0.5rem;
          letter-spacing: 1px;
        }

        .edit-journal-btn {
          margin-left: auto;
          padding: 0.25rem 0.75rem;
          background: #e5e7eb;
          border: none;
          border-radius: 4px;
          font-size: 0.8rem;
          font-family: 'Gilroy', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          font-weight: 500;
          color: #374151;
          cursor: pointer;
          transition: background 0.2s;
        }

        .edit-journal-btn:hover {
          background: #d1d5db;
        }

        .journal-content {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .emotions-tag {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          background: #fef9c3;
          color: #713f12;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 500;
          margin-bottom: 0.5rem;
          width: fit-content;
        }

        .journal-field {
          display: flex;
          gap: 0.5rem;
          font-size: 0.9rem;
          line-height: 1.5;
        }

        .field-label {
          font-weight: 600;
          color: #6b7280;
          min-width: 70px;
          flex-shrink: 0;
        }

        .field-text {
          color: #374151;
        }

        .journal-placeholder {
          color: #9ca3af;
          font-style: italic;
          font-size: 0.9rem;
        }

        .star-rating-input {
          display: flex;
          gap: 0.25rem;
          align-items: center;
        }

        .star-btn {
          background: none;
          border: none;
          font-size: 1.5rem;
          color: #d1d5db;
          cursor: pointer;
          padding: 0;
          line-height: 1;
          transition: color 0.15s;
        }

        .star-btn:hover {
          color: #fbbf24;
        }

        .star-btn.active {
          color: #f59e0b;
        }

        .daily-journal-editor .editor-field {
          margin-bottom: 0.75rem;
        }

        .daily-journal-editor .editor-row {
          display: grid;
          grid-template-columns: 1.5fr 1fr;
          gap: 1rem;
          margin-bottom: 0;
        }

        /* Weekly Group Styles */
        .weeks-list {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .week-group {
          background: white;
          border-radius: 16px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          overflow: hidden;
          border: 2px solid #e2e8f0;
        }

        .week-header {
          padding: 1.25rem 1.5rem;
          background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          transition: background 0.2s;
        }

        .week-header:hover {
          background: linear-gradient(135deg, #334155 0%, #475569 100%);
        }

        .week-info {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .week-header .expand-icon {
          color: #94a3b8;
          font-size: 0.9rem;
        }

        .week-icon {
          font-size: 1.25rem;
        }

        .week-date {
          font-weight: 700;
          font-size: 1.1rem;
          color: white;
        }

        .week-stats {
          font-size: 0.85rem;
          color: #94a3b8;
          background: rgba(255,255,255,0.1);
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
        }

        .week-rating {
          color: #fbbf24;
          font-size: 1rem;
          letter-spacing: 1px;
        }

        .week-pnl {
          display: flex;
          align-items: baseline;
          gap: 0.75rem;
          font-family: 'Gilroy', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          font-size: 1.1rem;
          font-weight: 700;
        }

        .week-pnl.profit {
          color: #4ade80;
        }

        .week-pnl.loss {
          color: #ef4444;
        }

        .week-pnl .unrealized-indicator {
          font-size: 0.8rem;
          opacity: 0.7;
          cursor: help;
          margin-left: -0.3rem;
        }

        /* Weekly Journal Section */
        .weekly-journal-section {
          border-bottom: 2px solid #e2e8f0;
          background: #f8fafc;
        }

        .weekly-journal-display {
          padding: 1.25rem 1.5rem;
          cursor: pointer;
          transition: background 0.2s;
        }

        .weekly-journal-display:hover {
          background: #f1f5f9;
        }

        .weekly-journal-editor {
          padding: 1.5rem;
          background: #f1f5f9;
        }

        .weekly-journal-editor .editor-field {
          margin-bottom: 0.75rem;
        }

        .weekly-journal-editor .editor-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          margin-bottom: 0;
        }

        .weekly-journal-editor .rating-row {
          grid-template-columns: 1fr;
          margin-top: 0.5rem;
        }

        .weekly-content {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem;
        }

        .positive-field .field-label {
          color: #059669;
        }

        .focus-field {
          grid-column: span 2;
          background: #eff6ff;
          padding: 0.5rem 0.75rem;
          border-radius: 6px;
          border-left: 3px solid #3b82f6;
        }

        /* Nested days within weeks */
        .week-group .days-list {
          padding: 0.5rem;
          background: #f8fafc;
        }

        .week-group .day-group {
          margin: 0.5rem;
          border-radius: 10px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        }

        .week-group .day-header {
          border-radius: 10px 10px 0 0;
        }

        .week-group .day-group.empty-day .day-header {
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}
