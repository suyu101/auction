'use client';

import {
  createContext, useContext, useState,
  useEffect, useCallback, useRef,
} from 'react';
import type { Auction }  from '@/lib/types';
import { useAuctions }   from '@/app/live/context/AuctionContext';
import { useAuth }       from '@/app/live/context/AuthContext';
import { supabase }      from '@/lib/supabase';

export type BidStatus = 'WINNING' | 'OUTBID' | 'WON' | 'LOST';

export interface MyBid {
  id:               string;
  auctionId:        string;
  auctionTitle:     string;
  auctionCategory:  string;
  myAmount:         number;
  currentPrice:     number;
  endsAt:           number;
  status:           BidStatus;
  placedAt:         number;
}

export interface BidStats {
  totalBids:       number;
  winning:         number;
  outbid:          number;
  won:             number;
  totalSpentOnWon: number;
  activeSpend:     number;
}

function computeStats(bids: MyBid[]): BidStats {
  return {
    totalBids:       bids.length,
    winning:         bids.filter(b => b.status === 'WINNING').length,
    outbid:          bids.filter(b => b.status === 'OUTBID').length,
    won:             bids.filter(b => b.status === 'WON').length,
    totalSpentOnWon: bids.filter(b => b.status === 'WON').reduce((s, b) => s + b.myAmount, 0),
    activeSpend:     bids.filter(b => b.status === 'WINNING').reduce((s, b) => s + b.myAmount, 0),
  };
}



// ── Context shape ─────────────────────────────────
interface MyBidsContextValue {
  bids:            MyBid[];
  activeBids:      MyBid[];
  historicalBids:  MyBid[];
  stats:           BidStats;
  hydrated:        boolean;
  placeBid:        (auction: Auction, amount: number) => void;
  clearBids:       () => void;
}

const MyBidsContext = createContext<MyBidsContextValue | null>(null);

export function MyBidsProvider({ children }: { children: React.ReactNode }) {
  const [bids, setBids]       = useState<MyBid[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const { state }             = useAuctions();
  const { user, loading }     = useAuth();

  const auctionsRef = useRef(state.auctions);
  useEffect(() => { auctionsRef.current = state.auctions; }, [state.auctions]);

  // Hydrate from DB once on mount / when user changes
  useEffect(() => {
    if (loading) return; // Wait until auth state is known

    if (!user) {
      setBids([]);
      setHydrated(true);
      return;
    }

    async function fetchBids(userId: string) {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('bids')
        .select('id, auction_id, amount, placed_at')
        .eq('user_id', userId)
        .order('placed_at', { ascending: false });

      if (error || !data || data.length === 0) {
        setBids([]);
        setHydrated(true);
        return;
      }

      // Group to keep only the highest bid per auction
      const bestBids = new Map<string, any>();
      for (const row of data) {
        const existing = bestBids.get(row.auction_id);
        if (!existing || row.amount > existing.amount) {
          bestBids.set(row.auction_id, row);
        }
      }

      const initialBids: MyBid[] = [];
      for (const row of Array.from(bestBids.values())) {
        const auction = auctionsRef.current.get(row.auction_id);
        if (!auction) continue; // auction not found in app state

        let status: BidStatus = 'WINNING';
        if (auction.status === 'SOLD') {
          status = auction.currentBid <= row.amount ? 'WON' : 'LOST';
        } else {
          status = auction.currentBid > row.amount ? 'OUTBID' : 'WINNING';
        }

        initialBids.push({
          id: row.id,
          auctionId: auction.id,
          auctionTitle: auction.title,
          auctionCategory: auction.category,
          myAmount: row.amount,
          currentPrice: auction.currentBid,
          endsAt: auction.endsAt,
          status,
          placedAt: new Date(row.placed_at).getTime(),
        });
      }

      // Sort recent first
      initialBids.sort((a, b) => b.placedAt - a.placedAt);
      setBids(initialBids);
      setHydrated(true);
    }

    fetchBids(user.id);
  }, [user, loading]);

  // Sync status + currentPrice whenever AuctionContext receives a new bid
  useEffect(() => {
    if (!hydrated) return;
    setBids(prev => prev.map(bid => {
      const live = state.auctions.get(bid.auctionId);
      if (!live) return bid;

      // If already WON/LOST, we don't change it back (terminal states)
      if (bid.status === 'WON' || bid.status === 'LOST') return bid;

      let status: BidStatus = bid.status;
      if (live.status === 'SOLD' || live.status === 'RESERVED') {
        status = live.currentBid <= bid.myAmount ? 'WON' : 'LOST';
      } else {
        status = live.currentBid > bid.myAmount ? 'OUTBID' : 'WINNING';
      }

      return { ...bid, currentPrice: live.currentBid, status };
    }));
  }, [state.lastUpdated, hydrated]);

  const placeBid = useCallback((auction: Auction, amount: number) => {
    const newBid: MyBid = {
      id:              `bid-${Date.now()}`,
      auctionId:       auction.id,
      auctionTitle:    auction.title,
      auctionCategory: auction.category,
      myAmount:        amount,
      currentPrice:    amount,
      endsAt:          auction.endsAt,
      status:          'WINNING',
      placedAt:        Date.now(),
    };
    setBids(prev => {
      const existing = prev.findIndex(b => b.auctionId === auction.id);
      if (existing !== -1) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], ...newBid };
        return updated;
      }
      return [newBid, ...prev];
    });
  }, []);

  const clearBids = useCallback(() => setBids([]), []);

  const stats          = computeStats(bids);
  const activeBids     = bids.filter(b => b.status === 'WINNING' || b.status === 'OUTBID').sort((a, b) => b.placedAt - a.placedAt);
  const historicalBids = bids.filter(b => b.status === 'WON'     || b.status === 'LOST').sort((a, b) => b.placedAt - a.placedAt);

  return (
    <MyBidsContext.Provider value={{ bids, activeBids, historicalBids, stats, hydrated, placeBid, clearBids }}>
      {children}
    </MyBidsContext.Provider>
  );
}

export function useMyBids() {
  const ctx = useContext(MyBidsContext);
  // Build-safe fallback
  return ctx || {
    bids: [],
    activeBids: [],
    historicalBids: [],
    stats: { totalBids: 0, winning: 0, outbid: 0, won: 0, totalSpentOnWon: 0, activeSpend: 0 },
    hydrated: false,
    placeBid: () => {},
    clearBids: () => {},
  } as MyBidsContextValue;
}