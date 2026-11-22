import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typedRoutes: true,
  headers() {
    // A private household tool: ask every crawler to stay out, on every response.
    // app/robots.ts says the same thing; neither is a lock — the PIN gate is (SPEC §10).
    return Promise.resolve([{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }])
  },
}

export default nextConfig
