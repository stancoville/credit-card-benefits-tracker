/**
 * Checks that every `source_url` in the catalog still resolves.
 *
 * A dead source link is a quiet failure: the figure looks sourced but nobody can check it,
 * which is most of the value of requiring a source at all. Issuers reorganise their sites
 * constantly, so this is worth running before a catalog PR and occasionally after.
 *
 *   pnpm check:links
 *
 * Deliberately not part of `pnpm test` — it needs the network, and a test suite that fails
 * because an issuer is having a bad afternoon is a test suite people learn to ignore.
 */

import { loadCatalog } from '@/lib/catalog'

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

async function statusOf(url: string): Promise<number | string> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': BROWSER_UA },
      signal: AbortSignal.timeout(20_000),
    })
    return response.status
  } catch (error) {
    return error instanceof Error ? error.name : 'failed'
  }
}

async function main(): Promise<void> {
  const catalog = loadCatalog({ includeTemplates: false })

  const usedBy = new Map<string, string[]>()
  for (const { file } of catalog.products) {
    for (const entry of file.benefits) {
      const list = usedBy.get(entry.source_url) ?? []
      list.push(`${file.product.slug}/${entry.slug}`)
      usedBy.set(entry.source_url, list)
    }
  }

  const urls = [...usedBy.keys()].sort()
  console.log(`Checking ${urls.length} source URLs across ${catalog.products.length} products…\n`)

  const broken: string[] = []
  for (const url of urls) {
    const status = await statusOf(url)
    const ok = status === 200
    if (!ok) broken.push(url)
    console.log(`${ok ? '  ok ' : ' FAIL'} ${String(status).padEnd(8)} ${url}`)
  }

  if (broken.length === 0) {
    console.log('\nEvery source URL resolves.')
    return
  }

  console.log(`\n${broken.length} URL(s) did not resolve:\n`)
  for (const url of broken) {
    console.log(`  ${url}`)
    for (const benefit of usedBy.get(url) ?? []) console.log(`      used by ${benefit}`)
  }
  console.log(
    '\nA 403 usually means the issuer is blocking automated requests rather than that the page\n' +
      'is gone — open it in a browser before changing anything.',
  )
  process.exitCode = 1
}

void main()
