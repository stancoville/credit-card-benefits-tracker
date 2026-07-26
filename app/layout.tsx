import type { Metadata } from 'next'
import { Archivo, IBM_Plex_Mono, Inter } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Benefits tracker',
  description: 'What money is about to evaporate.',
}

const DEMO_MODE = process.env.DEMO_MODE === 'true'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${inter.variable} ${plexMono.variable}`}>
      <body className="bg-paper text-ink min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>

        {DEMO_MODE ? (
          <p className="bg-amber text-ink px-4 py-2 text-center text-sm font-medium">
            Demo data. Nothing here is real, and changes reset nightly.
          </p>
        ) : null}

        <header className="border-hairline border-b">
          <nav
            aria-label="Main"
            className="mx-auto flex max-w-5xl flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-4 sm:px-6"
          >
            <Link href="/" className="display text-ink text-lg font-semibold">
              Benefits
            </Link>
            <div className="flex gap-4 text-sm">
              <Link href="/" className="hover:text-ink text-muted">
                Deadlines
              </Link>
              <Link href="/cards" className="hover:text-ink text-muted">
                Cards
              </Link>
            </div>
          </nav>
        </header>

        <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          {children}
        </main>

        <footer className="border-hairline text-muted mx-auto max-w-5xl border-t px-4 py-6 text-xs sm:px-6">
          Benefit data is community-maintained, unofficial, and not guaranteed accurate.
          Always check your issuer&rsquo;s terms.
        </footer>
      </body>
    </html>
  )
}
