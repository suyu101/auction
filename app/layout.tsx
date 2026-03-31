import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import TopBar from '@/components/layout/TopBar'
import SideBar from '@/components/layout/SideBar'
import { AuctionProvider }          from '@/app/live/context/AuctionContext';
import { ToastProvider }            from '@/app/live/context/ToastContext';
import ToastContainer               from '@/components/ui/ToastContainer';
import SimulatorProvider            from '@/components/layout/SimulatorProvider';
import { CommandPaletteProvider }   from '@/app/live/context/CommandPaletteContext';
import CommandPalette               from '@/components/ui/CommandPalette';
import { MyBidsProvider } from './live/context/MyBidsContext';
import { NotificationProvider } from './live/context/NotificationContext'
import PageTransition               from '@/components/layout/PageTransition';      
import { AuthProvider } from './live/context/AuthContext'
import { Suspense } from 'react'

const inter = Inter({
  subsets:  ['latin'],
  variable: '--font-inter',
  display:  'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets:  ['latin'],
  variable: '--font-jetbrains-mono',
  display:  'swap',
  weight:   ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: {
    default:  'Auction Terminal',
    template: '%s | Auction Terminal',
  },
  description: 'Live auction marketplace. Real-time bidding. Institutional grade.',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor:  '#080a0e',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body style={{ backgroundColor: 'var(--bg-void)' }}>
        <AuthProvider>
        <NotificationProvider>
        <AuctionProvider>
          <MyBidsProvider>
          <ToastProvider>
            <CommandPaletteProvider>                    {/* ← NEW wrapper */}

              {/* TopBar is sticky — stays at top as content scrolls */}
              <TopBar />
              <SimulatorProvider />

              {/*
                Two-column shell:
                CS Note: Classic "holy grail" layout using CSS Flexbox.
                The sidebar has a fixed width (flex-shrink: 0), and the main
                content area takes all remaining space (flex: 1).
              */}
              <div style={{
                display:   'flex',
                minHeight: 'calc(100vh - 76px)',
              }}>
                <SideBar />
                <main style={{
                  flex:          1,
                  overflow:      'hidden',
                  padding:       '28px 32px',
                  minWidth:      0,
                  display:       'flex',
                  flexDirection: 'column',
                }}>
                  <Suspense fallback = {null}>
                  <PageTransition>
                    {children}
                  </PageTransition>
                  </Suspense>
                </main>
              </div>

              <ToastContainer />
              <CommandPalette />                        {/* ← NEW: portal-style, fixed position */}

            </CommandPaletteProvider>                   {/* ← NEW close */}
          </ToastProvider>
          </MyBidsProvider>
        </AuctionProvider>
        </NotificationProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
