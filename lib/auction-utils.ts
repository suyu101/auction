import type { AuctionStatus } from './types';

/**
 * ── Centralized Auction Status State Machine ──
 * This function is the single source of truth for an auction's status based on time.
 * It's used during initial hydration, realtime updates, and background "Pulse" checks.
 */
export function calculateMarketStatus(
  startedAt: number,
  endsAt:    number,
  dbStatus:  AuctionStatus
): AuctionStatus {
  const now = Date.now();

  // 1. If it's already SOLD or RESERVED in DB, we respect that terminal state.
  if (dbStatus === 'SOLD' || dbStatus === 'RESERVED') return dbStatus;

  // 2. If the auction has ended but DB doesn't know it yet:
  if (now >= endsAt) return 'SOLD';

  // 3. Special Case: ENDING (sub-state of LIVE if < 1 hour remains)
  if (now < endsAt && now >= endsAt - 3600000) return 'ENDING';

  // 4. If it's started but not yet ending:
  if (now >= startedAt && now < endsAt - 3600000) return 'LIVE';

  // 5. Default: It must be UPCOMING if none of the above are true
  return 'UPCOMING';
}
