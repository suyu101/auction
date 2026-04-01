import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Suspense } from 'react'
import './globals.css'

// Layout Components
import TopBar from '@/components/layout/TopBar'
import SideBar from '@/components/layout/SideBar'
import PageTransition from '@/components/layout/PageTransition'
import SimulatorProvider from '@/components/layout/SimulatorProvider'

// Context Providers
import { AuthProvider } from './live/context/AuthContext'
import { NotificationProvider } from './live/context/NotificationContext'
import { AuctionProvider } from '@/app/live/context/AuctionContext'
import { MyBidsProvider } from './live/context/MyBidsContext'
import { ToastProvider } from '@/app/live/context/ToastContext'
import { CommandPaletteProvider } from '@/app/live/context/CommandPaletteContext'

// Global UI
import ToastContainer from '@/components/ui/ToastContainer'
import CommandPalette from '@/components/ui/CommandPalette'

export const dynamic = "force-dynamic"

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
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
                  <CommandPaletteProvider>
                    
                    {/* TopBar & Global Overlays */}
                    <Suspense fallback={null}><TopBar /></Suspense>
                    <SimulatorProvider />

                    <div style={{ display: 'flex', minHeight: 'calc(100vh - 76px)' }}>
                      {/* Sidebar with Suspense for SearchParams */}
                      <Suspense fallback={null}><SideBar /></Suspense>
                      
                      <main style={{
                        flex:          1,
                        overflow:      'hidden',
                        padding:       '28px 32px',
                        minWidth:      0,
                        display:       'flex',
                        flexDirection: 'column',
                      }}>
                        {/* Page Content with Transition and Suspense */}
                        <Suspense fallback={null}>
                          <PageTransition>
                            {children}
                          </PageTransition>
                        </Suspense>
                      </main>
                    </div>

                    <ToastContainer />
                    
                    {/* Command Palette with Suspense fallback for server-side stability */}
                    <Suspense fallback={null}><CommandPalette /></Suspense>

                  </CommandPaletteProvider>
                </ToastProvider>
              </MyBidsProvider>
            </AuctionProvider>
          </NotificationProvider>
        </AuthProvider>
      </body>
    </html>
  )
}