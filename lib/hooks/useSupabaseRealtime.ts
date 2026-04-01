'use client';

import { useEffect, useRef } from 'react';
import { supabase }           from '@/lib/supabase';
import { useAuctions }        from '@/app/live/context/AuctionContext';
import { useToast }           from '@/app/live/context/ToastContext';
import { useWatchlist }       from '@/lib/hooks/useWatchlist';
import { useNotifications }   from '@/app/live/context/NotificationContext';
import { useMyBids }          from '@/app/live/context/MyBidsContext';
import { useAuth }            from '@/app/live/context/AuthContext';
import { calculateMarketStatus } from '@/lib/auction-utils';

const BIDDER_HANDLES = [
  'usr_7x4k', 'usr_9m2p', 'usr_3r8q', 'usr_5t1n',
  'usr_2w6s', 'usr_8j4f', 'usr_4k9d', 'usr_6h3v',
  'usr_1b7c', 'usr_0x5z',
];

function randomHandle(): string {
  return BIDDER_HANDLES[Math.floor(Math.random() * BIDDER_HANDLES.length)];
}

function randomIncrement(currentBid: number): number {
  const roll = Math.random();
  if (roll < 0.60) return Math.ceil(currentBid * 0.01);
  if (roll < 0.85) return Math.ceil(currentBid * 0.03);
  if (roll < 0.95) return Math.ceil(currentBid * 0.07);
  return Math.ceil(currentBid * 0.15);
}

interface BidRow {
  id:         string;
  auction_id: string;
  amount:     number;
  bidder:     string;
  placed_at:  string;
}

interface RealtimeOptions {
  intervalMs?: number;
  enabled?:    boolean;
}

export function useSupabaseRealtime({
  intervalMs = 4000,
  enabled    = true,
}: RealtimeOptions = {}) {
  const { state, dispatch }    = useAuctions();
  const { warning, info }      = useToast();
  const { isWatching }         = useWatchlist();
  const { addNotification }    = useNotifications();
  const { bids }               = useMyBids();
  const { profile }            = useAuth();

  const stateRef      = useRef(state);
  const isWatchingRef = useRef(isWatching);
  const myBidsRef     = useRef(bids);
  // FIX: store the real user handle in a ref so the Realtime closure always
  // reads the latest value without going stale (same pattern as stateRef)
  const myHandleRef   = useRef(profile?.handle ?? null);

  useEffect(() => { stateRef.current      = state;              }, [state]);
  useEffect(() => { isWatchingRef.current = isWatching;         }, [isWatching]);
  useEffect(() => { myBidsRef.current     = bids;               }, [bids]);
  useEffect(() => { myHandleRef.current   = profile?.handle ?? null; }, [profile]);

  // ── 1. Realtime subscription ─────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel('bids-inserts')
      .on<BidRow>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bids' },
        ({ new: row }) => {
          const current = stateRef.current.auctions.get(row.auction_id);
          // Only dispatch if this bid is actually higher than what we have —
          // guards against stale Realtime events arriving out of order
          if (!current || row.amount <= current.currentBid) return;

          dispatch({
            type:    'BID_PLACED',
            payload: {
              auctionId: row.auction_id,
              newBid:    row.amount,
              bidder:    row.bidder,
            },
          });

          const auction     = stateRef.current.auctions.get(row.auction_id);
          const shortTitle  = auction
            ? auction.title.split(' ').slice(0, 4).join(' ')
            : row.auction_id;
          const priceStr    = `$${row.amount.toLocaleString('en-US')}`;

          // ── Watched item bid ──────────────────────────────────────────
          if (auction && isWatchingRef.current(row.auction_id)) {
            warning(
              'NEW BID ON WATCHED ITEM',
              `${shortTitle} → ${priceStr}`
            );
            addNotification(
              'WATCHED_BID',
              'New bid on watched item',
              `${shortTitle} → ${priceStr} by ${row.bidder}`,
            );
          }

          // ── Outbid detection ──────────────────────────────────────────
          // FIX: compare against the real user handle (myHandleRef.current)
          // instead of the hardcoded 'usr_me' that never matched anyone.
          // If no user is logged in, myHandleRef is null and we skip the
          // notification entirely (null !== row.bidder is always true, so
          // we guard explicitly).
          const myHandle = myHandleRef.current;

          const outbidEntry = myHandle
            ? myBidsRef.current.find(
                b => b.auctionId === row.auction_id &&
                     b.status    === 'WINNING'       &&
                     row.amount  >  b.myAmount        &&
                     row.bidder  !== myHandle          // don't notify on own bids
              )
            : undefined;

          if (outbidEntry) {
            warning(
              'YOU\'VE BEEN OUTBID',
              `${shortTitle} — new high ${priceStr}`
            );
            addNotification(
              'OUTBID',
              'You\'ve been outbid',
              `${shortTitle} — ${row.bidder} bid ${priceStr} (your bid: $${outbidEntry.myAmount.toLocaleString('en-US')})`,
            );
          }

          // ── Occasional market activity toast ──────────────────────────
          if (Math.random() < 0.125 && auction) {
            info(
              'MARKET ACTIVITY',
              `${auction.bidCount + 1} bids on ${auction.category} this session`
            );
          }
        }
      )
      .on<any>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'auctions' },
        ({ new: row }) => {
          let parsedEndsAt = Date.now() + 86400000;
          if (row.ends_at) {
            parsedEndsAt = typeof row.ends_at === 'string' ? new Date(row.ends_at).getTime() : Number(row.ends_at);
            if (parsedEndsAt < 20000000000) parsedEndsAt *= 1000;
            if (isNaN(parsedEndsAt)) parsedEndsAt = Date.now() + 86400000;
          }

          // Immediately add the newly created auction into global state
          // mock the UI fields so it renders perfectly on the market page without throwing TypeErrors
          const newAuction = {
            id:            row.id,
            title:         row.title,
            subtitle:      row.subtitle ?? 'Premium Auction Listing',
            category:      row.category,
            status:        calculateMarketStatus(row.started_at ? new Date(row.started_at).getTime() : Date.now(), parsedEndsAt, row.status),
            currentBid:    row.current_bid,
            reservePrice:  row.current_bid,
            startingPrice: row.current_bid,
            buyNowPrice:   null,
            bidCount:      row.bid_count,
            watcherCount:  0,
            endsAt:        parsedEndsAt,
            startedAt:     Date.now(),
            imageUrl:      row.image_url ?? null,
            seller: {
              handle:     `seller_${row.seller_id?.substring(0,6) || 'anon'}`,
              reputation: 100,
              totalSales: 0,
            },
            specs:         row.specs ?? {},
            recentBids:    [],
            priceHistory:  [{ t: Date.now(), price: row.current_bid }],
            tags:          row.tags ?? []
          };

          // Only dispatch if we don't already have it
          if (!stateRef.current.auctions.has(row.id)) {
            dispatch({ type: 'NEW_AUCTION', payload: newAuction as any });
            info('NEW LISTING FOUND', `${row.title} just hit the market!`);
          }
        }
      )
      .on<any>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'auctions' },
        ({ new: row }) => {
          const auction = stateRef.current.auctions.get(row.id);
          const nextStatus = auction 
            ? calculateMarketStatus(auction.startedAt, auction.endsAt, row.status)
            : row.status;

          // Sync any updates (like Admin force-close) directly into Context state
          dispatch({ 
            type: 'UPDATE_AUCTION', 
            payload: {
              id: row.id,
              status: nextStatus,
              currentBid: row.current_bid,
              title: row.title,
            } as any 
          });
        }
      )
      .on<any>(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'auctions' },
        ({ old }) => {
          // If an Admin deletes an auction entirely, instantly yank it from all connected clients
          dispatch({ 
            type: 'DELETE_AUCTION', 
            payload: { id: old.id } 
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── 2. Interval — writes to Supabase ─────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const id = setInterval(async () => {
      const liveAuctions = Array.from(stateRef.current.auctions.values()).filter(
        a => a.status === 'LIVE' || a.status === 'ENDING'
      );
      if (liveAuctions.length === 0) return;

      const endingAuctions = liveAuctions.filter(a => a.status === 'ENDING');
      const pool = Math.random() < 0.6 && endingAuctions.length > 0
        ? endingAuctions
        : liveAuctions;

      const auction   = pool[Math.floor(Math.random() * pool.length)];
      const increment = randomIncrement(auction.currentBid);
      const newBid    = auction.currentBid + increment;
      const bidder    = randomHandle();

      await supabase.from('bids').insert({
        auction_id: auction.id,
        amount:     newBid,
        bidder,
      });

      await supabase.from('auctions').update({
        current_bid: newBid,
        bid_count:   auction.bidCount + 1,
        updated_at:  new Date().toISOString(),
      }).eq('id', auction.id);

    }, intervalMs);

    return () => clearInterval(id);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs]);
}