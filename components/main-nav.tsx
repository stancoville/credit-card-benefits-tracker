'use client'

/**
 * The header's section links, with the current one marked — in ink and an underline, not a
 * colour, since amber/teal/maroon carry meaning and nothing else may borrow them (SPEC §6).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Deadlines', isCurrent: (path: string) => path === '/' },
  { href: '/cards', label: 'Cards', isCurrent: (path: string) => path.startsWith('/cards') },
] as const

export function MainNav() {
  const pathname = usePathname()

  return (
    <div className="flex gap-5 text-sm">
      {LINKS.map((link) => {
        const current = link.isCurrent(pathname)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? 'page' : undefined}
            className={`-mb-px border-b-2 pb-1 ${
              current
                ? 'border-ink text-ink font-medium'
                : 'text-muted hover:text-ink border-transparent'
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </div>
  )
}
