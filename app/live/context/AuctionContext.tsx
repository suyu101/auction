'use client';

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  ReactNode,
} from 'react';
// Auction state is now fully database-driven from Supabase
import type { Auction, AuctionStatus } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { calculateMarketStatus } from '@/lib/auction-utils';

// ── State shape ───────────────────────────────────
export interface AuctionState {
  auctions: Map<string, Auction>;
  lastUpdated: number;
}

// ── Actions ───────────────────────────────────────
export type AuctionAction =
  | {
      type: 'BID_PLACED';
      payload: {
        auctionId: string;
        newBid: number;
        bidder: string;
      };
    }
  | {
      type: 'AUCTION_SOLD';
      payload: {
        auctionId: string;
        finalPrice: number;
        buyer: string;
      };
    }
  | {
      type: 'HYDRATE_AUCTIONS';
      payload: Map<string, Auction>;
    }
  | {
      type: 'NEW_AUCTION';
      payload: Auction;
    }
  | {
      type: 'UPDATE_AUCTION';
      payload: Partial<Auction> & { id: string };
    }
  | {
      type: 'DELETE_AUCTION';
      payload: { id: string };
    }
  | {
      type: 'RESET';
    };

// ── Reducer ───────────────────────────────────────
function auctionReducer(
  state: AuctionState,
  action: AuctionAction
): AuctionState {
  switch (action.type) {
    case 'BID_PLACED': {
      const { auctionId, newBid, bidder } = action.payload;
      const auction = state.auctions.get(auctionId);
      if (!auction) return state;

      const updatedAuction: Auction = {
        ...auction,
        currentBid: newBid,
        bidCount:   auction.bidCount + 1,
        recentBids: [
          {
            id:        `bid-${Date.now()}`,
            bidder,
            amount:    newBid,
            timestamp: Date.now(),
          },
          ...auction.recentBids.slice(0, 4),
        ],
        priceHistory: [
          ...auction.priceHistory,
          { t: Date.now(), price: newBid },
        ],
      };

      const updatedAuctions = new Map(state.auctions);
      updatedAuctions.set(auctionId, updatedAuction);

      return { auctions: updatedAuctions, lastUpdated: Date.now() };
    }

    case 'AUCTION_SOLD': {
      const { auctionId, finalPrice, buyer } = action.payload;
      const auction = state.auctions.get(auctionId);
      if (!auction) return state;

      // Mark the auction as SOLD locally — this immediately hides the bid
      // input, countdown, and Buy Now button in every component reading
      // from AuctionContext, without waiting for a Realtime event.
      const updatedAuction: Auction = {
        ...auction,
        status:     'SOLD',
        currentBid: finalPrice,
        recentBids: [
          {
            id:        `bid-${Date.now()}`,
            bidder:    buyer,
            amount:    finalPrice,
            timestamp: Date.now(),
          },
          ...auction.recentBids.slice(0, 4),
        ],
        priceHistory: [
          ...auction.priceHistory,
          { t: Date.now(), price: finalPrice },
        ],
      };

      const updatedAuctions = new Map(state.auctions);
      updatedAuctions.set(auctionId, updatedAuction);

      return { auctions: updatedAuctions, lastUpdated: Date.now() };
    }

    case 'HYDRATE_AUCTIONS': {
      return { auctions: action.payload, lastUpdated: Date.now() };
    }

    case 'NEW_AUCTION': {
      const updatedAuctions = new Map(state.auctions);
      updatedAuctions.set(action.payload.id, action.payload);
      return { auctions: updatedAuctions, lastUpdated: Date.now() };
    }

    case 'UPDATE_AUCTION': {
      const auction = state.auctions.get(action.payload.id);
      if (!auction) return state;

      const nextMap = new Map(state.auctions);
      nextMap.set(action.payload.id, { ...auction, ...action.payload });

      return {
        ...state,
        auctions: nextMap,
        lastUpdated: Date.now(),
      };
    }

    case 'DELETE_AUCTION': {
      const nextMap = new Map(state.auctions);
      nextMap.delete(action.payload.id);
      
      return {
        ...state,
        auctions: nextMap,
        lastUpdated: Date.now(),
      };
    }

    case 'RESET': {
      return buildInitialState();
    }

    default:
      return state;
  }
}

// ── Boot sequence ───────────────────────────────────
function buildInitialState(): AuctionState {
  // Initialize with completely empty maps; we strictly pull from the Database
  const auctionsMap = new Map<string, Auction>();
  return {
    auctions: auctionsMap,
    lastUpdated: Date.now(),
  };
}

// ── Context types ─────────────────────────────────
interface AuctionContextValue {
  state:    AuctionState;
  dispatch: React.Dispatch<AuctionAction>;
  getLiveAuctions:  () => Auction[];
  getAuction:       (id: string) => Auction | undefined;
  getAllAuctions:    () => Auction[];
}

const AuctionContext = createContext<AuctionContextValue | null>(null);

// ── Provider ──────────────────────────────────────
export function AuctionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(auctionReducer, undefined, buildInitialState);

  // Fetch from Supabase on mount
  useEffect(() => {
    async function hydrateAuctions() {
      if (!supabase) return;
      // Fetch auctions and recent bids in parallel
      const [auctionsRes, bidsRes] = await Promise.all([
        supabase.from('auctions').select('*'),
        supabase
          .from('bids')
          .select('id, auction_id, amount, bidder, placed_at')
          .order('placed_at', { ascending: false })
          .limit(500), // grab enough recent bids to cover all auctions
      ]);

      if (auctionsRes.error || !auctionsRes.data) return;

      // Group bids by auction_id for O(1) lookup
      const bidsByAuction = new Map<string, typeof bidsRes.data>();
      if (bidsRes.data) {
        for (const bid of bidsRes.data) {
          if (!bidsByAuction.has(bid.auction_id)) {
            bidsByAuction.set(bid.auction_id, []);
          }
          bidsByAuction.get(bid.auction_id)!.push(bid);
        }
      }

      const newMap = new Map<string, Auction>();

      for (const row of auctionsRes.data) {
        let safeStatus = row.status as AuctionStatus;
        if (safeStatus === ('OUTBID' as any)) safeStatus = 'ENDING';

        // ── Date parsing — handle ISO strings or numeric timestamps ──
        let parsedEndsAt = typeof row.ends_at === 'string' ? new Date(row.ends_at).getTime() : Number(row.ends_at);
        if (isNaN(parsedEndsAt)) parsedEndsAt = Date.now() + 86400000;
        
        const parsedStartedAt = row.started_at 
          ? (typeof row.started_at === 'string' ? new Date(row.started_at).getTime() : Number(row.started_at))
          : parsedEndsAt - 86400000 * 7;
        
        // ── Deterministic Status Calculation ──────────────────────────
        // This ensures the initial state is perfectly synced with the current clock
        safeStatus = calculateMarketStatus(parsedStartedAt, parsedEndsAt, safeStatus);

        // Build recentBids and priceHistory from the persisted bids table
        const auctionBids = (bidsByAuction.get(row.id) ?? []).slice(0, 5);
        const recentBids = auctionBids.map(b => ({
          id:        b.id,
          bidder:    b.bidder,
          amount:    b.amount,
          timestamp: new Date(b.placed_at).getTime(),
        }));

        // Build price history: start from starting price, add each bid in chronological order
        const priceHistory: { t: number; price: number }[] = [
          { t: parsedStartedAt, price: row.current_bid },
          ...auctionBids
            .slice()
            .reverse() // oldest first for chart
            .map(b => ({ t: new Date(b.placed_at).getTime(), price: b.amount })),
        ];

        // Initialize UI fields purely from PostgreSQL 
        const mappedAuction: Auction = {
          id:            row.id,
          title:         row.title,
          subtitle:      row.subtitle ?? 'Premium Auction Listing',
          category:      row.category,
          status:        safeStatus,
          currentBid:    row.current_bid,
          reservePrice:  row.current_bid,
          startingPrice: row.current_bid,
          buyNowPrice:   null,
          bidCount:      row.bid_count,
          watcherCount:  0,
          endsAt:        parsedEndsAt,
          startedAt:     parsedStartedAt,
          imageUrl:      row.image_url ?? null,
          seller: {
            handle:     `seller_${row.seller_id?.substring(0,6) || 'anon'}`,
            reputation: 100,
            totalSales: 0,
          },
          specs:        row.specs ?? {},
          recentBids,
          priceHistory,
          tags:         row.tags ?? [],
        };

        newMap.set(row.id, mappedAuction);
      }
      dispatch({ type: 'HYDRATE_AUCTIONS', payload: newMap });
    }
    
    hydrateAuctions();
  }, [dispatch]);

  // ── Background Status "Pulse" ──────────────────────────────────────────
  // Re-calculates all statuses every 30 seconds to ensure transitions
  // (e.g. LIVE -> ENDING -> SOLD) happen without needing a page refresh or
  // Realtime update from the server.
  useEffect(() => {
    const pulse = setInterval(() => {
      const updates: { id: string, status: AuctionStatus }[] = [];
      
      for (const a of Array.from(state.auctions.values())) {
        const nextStatus = calculateMarketStatus(a.startedAt, a.endsAt, a.status);
        if (nextStatus !== a.status) {
          updates.push({ id: a.id, status: nextStatus });
        }
      }

      if (updates.length > 0) {
        updates.forEach(u => dispatch({ type: 'UPDATE_AUCTION', payload: u }));
      }
    }, 30000);

    return () => clearInterval(pulse);
  }, [state.auctions, dispatch]);

  const getLiveAuctions = useCallback(() => {
    return Array.from(state.auctions.values()).filter(
      a => a.status === 'LIVE' || a.status === 'ENDING' || a.status === 'UPCOMING'
    );
  }, [state.auctions]);

  const getAuction = useCallback(
    (id: string) => state.auctions.get(id),
    [state.auctions]
  );

  const getAllAuctions = useCallback(
    () => Array.from(state.auctions.values()),
    [state.auctions]
  );

  const value = useMemo(
    () => ({ state, dispatch, getLiveAuctions, getAuction, getAllAuctions }),
    [state, dispatch, getLiveAuctions, getAuction, getAllAuctions]
  );

  return (
    <AuctionContext.Provider value={value}>
      {children}
    </AuctionContext.Provider>
  );
}

// ── Custom hook ───────────────────────────────────
export function useAuctions() {
  const ctx = useContext(AuctionContext);
  // Build-safe fallback
  return ctx || {
    state: { auctions: new Map(), lastUpdated: Date.now() },
    dispatch: () => {},
    getLiveAuctions: () => [],
    getAuction: () => undefined,
    getAllAuctions: () => [],
  } as AuctionContextValue;
}