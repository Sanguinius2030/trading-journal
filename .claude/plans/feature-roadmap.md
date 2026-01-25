# Trading Journal Feature Roadmap

## Completed Features
- [x] Calendar Tab - Monthly heatmap with PnL color intensity
- [x] Projection Tab - Growth projections with milestones
- [x] Dashboard - Positions list with day/week grouping, journal entries
- [x] Stats Tab - Comprehensive analytics with performance breakdowns

---

## Upcoming Features

### ~~1. Stats Tab (High Priority)~~ COMPLETED
A dedicated analytics page with comprehensive trading statistics.

**Core Metrics:**
- Win rate (% of profitable trades)
- Profit factor (gross profit / gross loss)
- Expectancy (average expected return per trade)
- Average winner vs average loser
- Largest winner / Largest loser
- Max consecutive wins / losses
- Current streak

**Performance Breakdowns:**
- By hour of day (heatmap or bar chart)
- By day of week
- By market/symbol
- By position type (Long vs Short)
- By category/setup
- By timeframe (scalp/intraday/swing)

**Estimated effort:** Medium

---

### 2. Charts Tab (Medium Priority)
Visual representation of trading performance over time.

**Charts to include:**
- Equity curve (portfolio value over time)
- Cumulative PnL chart (running total)
- PnL distribution histogram (how often you hit certain P&L ranges)
- Drawdown chart (peak to trough losses)
- Win/loss streak visualization

**Estimated effort:** Medium

---

### 3. Enhanced Journal Entry Fields (Low-Medium Priority)
Add more structured data capture for each trade.

**New fields:**
- Screenshot upload (chart image for each trade)
- Market conditions tag (trending, ranging, volatile, choppy)
- Confidence level (1-5 rating before trade)
- Plan adherence (Did you follow your rules? Yes/No/Partial)
- Mistake tags (FOMO, revenge trade, oversize, early exit, moved stop, etc.)
- Planned vs actual R:R

**Estimated effort:** Medium-High (screenshot upload requires storage)

---

### 4. Trade Tagging System (Low Priority)
Flexible tagging for better filtering and analysis.

**Features:**
- Multiple custom tags per trade
- Tag management (create, edit, delete tags)
- Tag-based filtering on dashboard
- Tag performance reports in Stats tab
- Auto-suggested tags based on trade characteristics

**Estimated effort:** Medium

---

### 5. Weekly/Monthly Summary Reports (Low Priority)
Automated summary generation.

**Features:**
- Weekly recap with key stats
- Monthly performance report
- Best/worst trades of period
- Patterns identified
- Export to PDF option

**Estimated effort:** Medium

---

## Implementation Order Recommendation

| Order | Feature | Reason |
|-------|---------|--------|
| 1 | **Stats Tab** | High value - gives deep insights into what's working |
| 2 | **Charts Tab** | Visual feedback on progress, complements Stats |
| 3 | **Mistake Tags** | Quick win - helps identify behavioral patterns |
| 4 | **Plan Adherence** | Quick win - tracks discipline |
| 5 | **Trade Tagging** | Builds on existing category system |
| 6 | **Screenshots** | Requires more infrastructure (storage) |
| 7 | **Summary Reports** | Nice to have, lower priority |

---

## Notes

- Stats and Charts tabs can share some calculations
- Consider adding a "Quick Stats" widget to dashboard sidebar
- Mistake tags could be predefined list + custom option
- Screenshot storage options: Supabase Storage, local file references, or base64 in DB (not recommended for large images)
