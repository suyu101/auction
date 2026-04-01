'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/live/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { calculateMarketStatus } from '@/lib/auction-utils';

// ── Types ─────────────────────────────────────────
interface AdminUser {
  id:              string;
  handle:          string;
  avatar_initials: string;
  balance:         number;
  role:            'buyer' | 'seller' | 'manager';
  banned:          boolean;
  created_at:      string;
}

interface AdminAuction {
  id:          string;
  title:       string;
  category:    string;
  current_bid: number;
  bid_count:   number;
  status:      string;
  started_at:  string | null;
  ends_at:     string | null;
  seller_id:   string | null;
}

interface Stats {
  totalUsers:    number;
  totalBids:     number;
  totalRevenue:  number;
  liveAuctions:  number;
  bannedUsers:   number;
}

type Tab = 'stats' | 'users' | 'auctions';

const ROLE_COLORS = {
  buyer:   'var(--accent-green)',
  seller:  'var(--accent-amber)',
  manager: 'var(--accent-red)',
} as const;

const STATUS_COLORS: Record<string, string> = {
  LIVE:     'var(--accent-green)',
  ENDING:   'var(--accent-amber)',
  UPCOMING: 'var(--accent-blue)',
  SOLD:     'var(--text-tertiary)',
  RESERVED: 'var(--accent-red)',
};

function formatPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(s: string | null | undefined) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── ACCESS DENIED ─────────────────────────────────
function AccessDenied({ role }: { role: string }) {
  const router = useRouter();
  return (
    <div style={{
      minHeight:      '60vh',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            '16px',
      textAlign:      'center',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '48px', color: 'var(--accent-red)', lineHeight: 1, marginBottom: '8px' }}>
        ✕
      </div>
      <p className="mono" style={{ fontSize: '18px', letterSpacing: '0.12em', color: 'var(--accent-red)', fontWeight: 700 }}>
        ACCESS DENIED
      </p>
      <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
        Admin panel requires a manager account.
      </p>
      <span className="mono" style={{
        fontSize: '11px', color: 'var(--accent-red)',
        backgroundColor: 'color-mix(in srgb, var(--accent-red) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent-red) 25%, transparent)',
        padding: '4px 14px', borderRadius: '4px', letterSpacing: '0.1em',
      }}>
        YOUR ROLE: {role.toUpperCase()}
      </span>
      <button
        onClick={() => router.push('/')}
        style={{
          marginTop: '8px', padding: '10px 24px',
          backgroundColor: 'var(--bg-elevated)', border: 'var(--border-default)',
          borderRadius: '6px', color: 'var(--text-secondary)',
          fontFamily: 'var(--font-mono)', fontSize: '11px',
          letterSpacing: '0.06em', cursor: 'pointer',
        }}
      >
        ← BACK TO MARKET
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════
//  ADMIN PAGE
// ══════════════════════════════════════════════════
export default function AdminPage() {
  const authContext                 = useAuth();
  const { user, profile, loading } = authContext || { user: null, profile: null, loading: true };
  const router                     = useRouter();

  const [tab,             setTab]             = useState<Tab>('stats');
  const [users,           setUsers]           = useState<AdminUser[]>([]);
  const [auctions,        setAuctions]        = useState<AdminAuction[]>([]);
  const [stats,           setStats]           = useState<Stats | null>(null);
  const [fetching,        setFetching]        = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting,        setDeleting]        = useState(false);

  // ── Fetch all data ────────────────────────────
  async function fetchAll() {
    if (!supabase) return;
    setFetching(true);

    const [usersRes, auctionsRes, bidsRes] = await Promise.all([
      supabase.from('users').select('*').order('created_at', { ascending: false }),
      supabase.from('auctions').select('*').order('ends_at', { ascending: true }),
      supabase.from('bids').select('amount', { count: 'exact' }),
    ]);

    if (usersRes.error)    console.error('Admin Users Error:', usersRes.error);
    if (auctionsRes.error) console.error('Admin Auctions Error:', auctionsRes.error);
    if (bidsRes.error)     console.error('Admin Bids Error:', bidsRes.error);

    const usersData    = usersRes.data    ?? [];
    const rawAuctionsData = auctionsRes.data ?? [];
    
    // Scrub historical database states that were permanently stored as 'OUTBID'
    const auctionsData = rawAuctionsData.map((a: any) => ({
      ...a,
      current_bid: a.current_bid ?? a.currentBid ?? 0,
      bid_count:   a.bid_count   ?? a.bidCount   ?? 0,
      status:      a.status === 'OUTBID' ? 'ENDING' : a.status,
      // We'll calculate the true status at render-time for live reactivity
    }));

    const bidCount     = bidsRes.count    ?? 0;

    setUsers(usersData);
    setAuctions(auctionsData);

    const revenue     = auctionsData
      .filter((a: AdminAuction) => a.status === 'SOLD')
      .reduce((sum: number, a: AdminAuction) => sum + a.current_bid, 0);
    const liveCount   = auctionsData.filter((a: AdminAuction) => a.status === 'LIVE' || a.status === 'ENDING').length;
    const bannedCount = usersData.filter((u: AdminUser) => u.banned).length;

    setStats({
      totalUsers:   usersData.length,
      totalBids:    bidCount,
      totalRevenue: revenue,
      liveAuctions: liveCount,
      bannedUsers:  bannedCount,
    });

    setFetching(false);
  }

  useEffect(() => { fetchAll(); }, [user]);
  
  // Re-trigger render every 30s to update the "calculateMarketStatus" outputs in the table
  useEffect(() => {
    const timer = setInterval(() => {
      // We don't necessarily need to re-fetch from DB, 
      // just forcing a state update is enough to re-run the render loop
      setAuctions(prev => [...prev]);
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  // ── Guards ────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <span className="mono" style={{ fontSize: '12px', color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>
          LOADING...
        </span>
      </div>
    );
  }
  
  if (!user) return null;
  if (profile?.role && profile.role !== 'manager') return <AccessDenied role={profile.role} />;

  // ── User actions ──────────────────────────────
  async function toggleBan(u: AdminUser) {
    await supabase.from('users').update({ banned: !u.banned }).eq('id', u.id);
    await fetchAll();
  }

  async function changeRole(u: AdminUser, role: AdminUser['role']) {
    await supabase.from('users').update({ role }).eq('id', u.id);
    await fetchAll();
  }

  // ── Auction actions ───────────────────────────
  async function forceClose(id: string) {
    await supabase.from('auctions')
      .update({ status: 'SOLD', updated_at: new Date().toISOString() })
      .eq('id', id);
    await fetchAll();
  }

  async function deleteAuction(id: string) {
    // Show inline confirmation instead of browser prompt
    setConfirmDeleteId(id);
  }

  async function executeDelete(id: string) {
    setDeleting(true);
    // Must delete child bids first — the bids table has a FK referencing auctions.id
    await supabase.from('bids').delete().eq('auction_id', id);
    await supabase.from('auctions').delete().eq('id', id);
    setConfirmDeleteId(null);
    setDeleting(false);
    await fetchAll();
  }

  // ══════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2 className="mono" style={{
            fontSize: '18px', fontWeight: 700,
            letterSpacing: '0.04em', color: 'var(--text-primary)',
          }}>
            ADMIN PANEL
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {profile?.handle} · full platform access
          </p>
        </div>
        <span className="mono" style={{ fontSize: '11px', color: 'var(--accent-red)', letterSpacing: '0.06em' }}>
          ● MANAGER
        </span>
      </div>

      {/* ── Tabs ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        borderBottom: 'var(--border-subtle)', marginBottom: '4px',
      }}>
        {([
          ['stats',    'PLATFORM STATS'],
          ['users',    'USERS'],
          ['auctions', 'AUCTIONS'],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding:      '12px',
              background:   'none',
              border:       'none',
              borderBottom: tab === t
                ? '2px solid var(--accent-red)'
                : '2px solid transparent',
              color:           tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontFamily:      'var(--font-mono)',
              fontSize:        '11px',
              letterSpacing:   '0.07em',
              cursor:          'pointer',
              transition:      'var(--transition-fast)',
            }}
          >
            {label}
            {t === 'users'    && ` (${users.length})`}
            {t === 'auctions' && ` (${auctions.length})`}
          </button>
        ))}
      </div>

      {/* ══ STATS TAB ════════════════════════════ */}
      {tab === 'stats' && stats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
            {[
              { label: 'TOTAL USERS',   value: stats.totalUsers.toLocaleString(),              color: 'var(--accent-blue)'  },
              { label: 'TOTAL BIDS',    value: stats.totalBids.toLocaleString(),               color: 'var(--accent-green)' },
              { label: 'GMV',           value: `$${formatPrice(stats.totalRevenue)}`,          color: 'var(--accent-green)' },
              { label: 'LIVE AUCTIONS', value: stats.liveAuctions.toLocaleString(),            color: 'var(--accent-amber)' },
              { label: 'BANNED USERS',  value: stats.bannedUsers.toLocaleString(),             color: 'var(--accent-red)'   },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                backgroundColor: 'var(--bg-surface)',
                border:          'var(--border-subtle)',
                borderRadius:    '8px',
                padding:         '20px 16px',
                display:         'flex',
                flexDirection:   'column',
                gap:             '8px',
              }}>
                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>
                  {label}
                </span>
                <span className="mono" style={{ fontSize: '22px', fontWeight: 700, color, letterSpacing: '-0.02em' }}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          {/* Role breakdown */}
          <div style={{
            backgroundColor: 'var(--bg-surface)',
            border:          'var(--border-subtle)',
            borderRadius:    '8px',
            overflow:        'hidden',
          }}>
            <div style={{
              padding: '14px 20px', borderBottom: 'var(--border-subtle)',
              fontSize: '11px', letterSpacing: '0.07em',
              color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)',
            }}>
              USER BREAKDOWN BY ROLE
            </div>
            <div style={{ padding: '20px', display: 'flex', gap: '32px' }}>
              {(['buyer', 'seller', 'manager'] as const).map(role => {
                const count = users.filter(u => u.role === role).length;
                const pct   = users.length ? Math.round((count / users.length) * 100) : 0;
                const color = ROLE_COLORS[role];
                return (
                  <div key={role} style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '120px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="mono" style={{ fontSize: '11px', color, letterSpacing: '0.06em' }}>
                        {role.toUpperCase()}
                      </span>
                      <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {count}
                      </span>
                    </div>
                    <div style={{ height: '4px', borderRadius: '2px', backgroundColor: 'var(--bg-elevated)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`,
                        backgroundColor: color, borderRadius: '2px',
                        boxShadow: `0 0 6px color-mix(in srgb, ${color} 50%, transparent)`,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{pct}% of users</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ USERS TAB ════════════════════════════ */}
      {tab === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>

          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 90px 110px 100px 180px',
            gap: '0 12px', padding: '0 16px',
            fontSize: '10px', letterSpacing: '0.06em', color: 'var(--text-tertiary)',
          }}>
            <span>HANDLE</span>
            <span>USER ID</span>
            <span style={{ textAlign: 'right' }}>BALANCE</span>
            <span style={{ textAlign: 'center' }}>ROLE</span>
            <span style={{ textAlign: 'center' }}>STATUS</span>
            <span style={{ textAlign: 'center' }}>ACTIONS</span>
          </div>

          {fetching ? (
            <p className="mono" style={{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '24px 16px' }}>
              LOADING USERS...
            </p>
          ) : users.map(u => {
            const roleColor = ROLE_COLORS[u.role] ?? 'var(--text-tertiary)';
            const isSelf    = u.id === user!.id;

            return (
              <div
                key={u.id}
                style={{
                  display:             'grid',
                  gridTemplateColumns: '140px 1fr 90px 110px 100px 180px',
                  gap:                 '0 12px',
                  alignItems:          'center',
                  padding:             '12px 16px',
                  backgroundColor:     u.banned
                    ? 'color-mix(in srgb, var(--accent-red) 5%, var(--bg-surface))'
                    : 'var(--bg-surface)',
                  border: u.banned
                    ? '1px solid color-mix(in srgb, var(--accent-red) 15%, transparent)'
                    : 'var(--border-subtle)',
                  borderRadius: '6px',
                  opacity: isSelf ? 0.7 : 1,
                }}
              >
                {/* Handle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '50%',
                    backgroundColor: 'var(--bg-elevated)',
                    border: `1px solid ${roleColor}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-mono)', fontSize: '9px',
                    color: roleColor, fontWeight: 700, flexShrink: 0,
                  }}>
                    {u.avatar_initials}
                  </div>
                  <span className="mono" style={{ fontSize: '12px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.handle}
                  </span>
                </div>

                {/* ID */}
                <span className="mono" style={{ fontSize: '9px', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.id}
                </span>

                {/* Balance */}
                <span className="mono" style={{ fontSize: '12px', color: 'var(--accent-green)', textAlign: 'right' }}>
                  ${formatPrice(u.balance)}
                </span>

                {/* Role badge */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <span className="mono" style={{
                    fontSize: '9px', letterSpacing: '0.08em', fontWeight: 700,
                    color: roleColor,
                    backgroundColor: `color-mix(in srgb, ${roleColor} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${roleColor} 30%, transparent)`,
                    padding: '3px 8px', borderRadius: '3px',
                  }}>
                    {u.role.toUpperCase()}
                  </span>
                </div>

                {/* Status */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {u.banned ? (
                    <span className="mono" style={{
                      fontSize: '9px', letterSpacing: '0.08em', fontWeight: 700,
                      color: 'var(--accent-red)',
                      backgroundColor: 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)',
                      padding: '3px 8px', borderRadius: '3px',
                    }}>
                      BANNED
                    </span>
                  ) : (
                    <span className="mono" style={{
                      fontSize: '9px', letterSpacing: '0.08em', fontWeight: 700,
                      color: 'var(--accent-green)',
                      backgroundColor: 'color-mix(in srgb, var(--accent-green) 10%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--accent-green) 30%, transparent)',
                      padding: '3px 8px', borderRadius: '3px',
                    }}>
                      ACTIVE
                    </span>
                  )}
                </div>

                {/* Actions */}
                {isSelf ? (
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                      (you)
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    {/* Ban / unban */}
                    <button
                      onClick={() => toggleBan(u)}
                      style={{
                        padding: '4px 8px', borderRadius: '3px',
                        backgroundColor: u.banned
                          ? 'color-mix(in srgb, var(--accent-green) 10%, transparent)'
                          : 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
                        border: u.banned
                          ? '1px solid color-mix(in srgb, var(--accent-green) 30%, transparent)'
                          : '1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)',
                        color: u.banned ? 'var(--accent-green)' : 'var(--accent-red)',
                        fontFamily: 'var(--font-mono)', fontSize: '9px',
                        letterSpacing: '0.05em', cursor: 'pointer',
                      }}
                    >
                      {u.banned ? 'UNBAN' : 'BAN'}
                    </button>

                    {/* Role change */}
                    {(['buyer', 'seller', 'manager'] as const)
                      .filter(r => r !== u.role)
                      .map(r => (
                        <button
                          key={r}
                          onClick={() => changeRole(u, r)}
                          style={{
                            padding: '4px 8px', borderRadius: '3px',
                            backgroundColor: 'var(--bg-elevated)',
                            border: 'var(--border-subtle)',
                            color: ROLE_COLORS[r],
                            fontFamily: 'var(--font-mono)', fontSize: '9px',
                            letterSpacing: '0.05em', cursor: 'pointer',
                          }}
                        >
                          → {r.toUpperCase()}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ══ AUCTIONS TAB ═════════════════════════ */}
      {tab === 'auctions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>

          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 100px 70px 100px 140px',
            gap: '0 12px', padding: '0 16px',
            fontSize: '10px', letterSpacing: '0.06em', color: 'var(--text-tertiary)',
          }}>
            <span>TITLE</span>
            <span style={{ textAlign: 'right' }}>CURRENT BID</span>
            <span style={{ textAlign: 'center' }}>BIDS</span>
            <span style={{ textAlign: 'center' }}>STATUS</span>
            <span style={{ textAlign: 'center' }}>ACTIONS</span>
          </div>

          {fetching ? (
            <p className="mono" style={{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '24px 16px' }}>
              LOADING AUCTIONS...
            </p>
          ) : auctions.map(a => {
            // ── Dynamic Status Calculation ──────────────────────────
            // Ensures the Admin view is perfectly synced with the real-time clock
            const startsAt = a.started_at ? new Date(a.started_at).getTime() : Date.now();
            const endsAt   = a.ends_at     ? new Date(a.ends_at).getTime()   : Date.now();
            const currentStatus = calculateMarketStatus(startsAt, endsAt, a.status as any);

            const statusColor = STATUS_COLORS[currentStatus] ?? 'var(--text-tertiary)';
            const canClose    = currentStatus === 'LIVE' || currentStatus === 'ENDING' || currentStatus === 'UPCOMING';
            const isConfirming = confirmDeleteId === a.id;

            return (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {/* ── Row ── */}
                <div
                  style={{
                    display:             'grid',
                    gridTemplateColumns: '1fr 100px 70px 100px 140px',
                    gap:                 '0 12px',
                    alignItems:          'center',
                    padding:             '12px 16px',
                    backgroundColor:     isConfirming
                      ? 'color-mix(in srgb, var(--accent-red) 5%, var(--bg-surface))'
                      : 'var(--bg-surface)',
                    border:              isConfirming
                      ? '1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)'
                      : 'var(--border-subtle)',
                    borderRadius:        isConfirming ? '6px 6px 0 0' : '6px',
                    transition:          'background-color 150ms ease, border-color 150ms ease',
                  }}
                >
                  {/* Title */}
                  <div style={{ minWidth: 0 }}>
                    <p style={{
                      fontSize: '13px', fontWeight: 500,
                      color: 'var(--text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {a.title}
                    </p>
                    <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                      {a.category} · {a.id}
                    </p>
                  </div>

                  {/* Bid */}
                  <span className="mono" style={{ color: 'var(--accent-green)', fontSize: '13px', fontWeight: 600, textAlign: 'right' }}>
                    ${formatPrice(a.current_bid)}
                  </span>

                  {/* Count */}
                  <span className="mono" style={{ color: 'var(--text-secondary)', fontSize: '12px', textAlign: 'center' }}>
                    {a.bid_count}
                  </span>

                  {/* Status */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <span className="mono" style={{
                      color: statusColor,
                      backgroundColor: `color-mix(in srgb, ${statusColor} 10%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${statusColor} 30%, transparent)`,
                      padding: '3px 8px', borderRadius: '3px',
                      fontSize: '9px', letterSpacing: '0.08em', fontWeight: 600,
                    }}>
                      {currentStatus}
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                    {canClose ? (
                      <button
                        onClick={() => forceClose(a.id)}
                        style={{
                          padding: '4px 8px', borderRadius: '3px',
                          backgroundColor: 'var(--bg-elevated)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono)', fontSize: '9px',
                          letterSpacing: '0.05em', cursor: 'pointer',
                        }}
                      >
                        FORCE CLOSE
                      </button>
                    ) : null}
                    <button
                      onClick={() => isConfirming ? setConfirmDeleteId(null) : deleteAuction(a.id)}
                      style={{
                        padding: '4px 8px', borderRadius: '3px',
                        backgroundColor: isConfirming
                          ? 'color-mix(in srgb, var(--accent-red) 20%, transparent)'
                          : 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--accent-red) 25%, transparent)',
                        color: 'var(--accent-red)',
                        fontFamily: 'var(--font-mono)', fontSize: '9px',
                        letterSpacing: '0.05em', cursor: 'pointer',
                      }}
                    >
                      {isConfirming ? 'CANCEL' : 'DELETE'}
                    </button>
                  </div>
                </div>

                {/* ── Inline confirmation panel ── */}
                {isConfirming && (
                  <div style={{
                    padding: '12px 16px',
                    backgroundColor: 'color-mix(in srgb, var(--accent-red) 8%, var(--bg-elevated))',
                    border: '1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)',
                    borderTop: 'none',
                    borderRadius: '0 0 6px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}>
                    <div>
                      <p className="mono" style={{ fontSize: '11px', color: 'var(--accent-red)', fontWeight: 700, letterSpacing: '0.06em' }}>
                        ⚠ PERMANENT DELETION
                      </p>
                      <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '3px' }}>
                        Deletes <strong style={{ color: 'var(--text-secondary)' }}>{a.title}</strong> and all {a.bid_count} associated bids. Cannot be undone.
                      </p>
                    </div>
                    <button
                      onClick={() => executeDelete(a.id)}
                      disabled={deleting}
                      style={{
                        flexShrink: 0,
                        padding: '7px 16px', borderRadius: '4px',
                        backgroundColor: deleting ? 'var(--bg-elevated)' : 'var(--accent-red)',
                        border: 'none',
                        color: deleting ? 'var(--accent-red)' : '#fff',
                        fontFamily: 'var(--font-mono)', fontSize: '10px',
                        fontWeight: 700, letterSpacing: '0.05em',
                        cursor: deleting ? 'not-allowed' : 'pointer',
                        transition: 'var(--transition-fast)',
                        boxShadow: deleting ? 'none' : '0 0 12px color-mix(in srgb, var(--accent-red) 40%, transparent)',
                      }}
                    >
                      {deleting ? 'DELETING...' : 'CONFIRM DELETE →'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}