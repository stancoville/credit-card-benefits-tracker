import type { MetadataRoute } from 'next'

/** Disallow everything. A request, not a lock — the PIN gate is the lock (SPEC §10). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
