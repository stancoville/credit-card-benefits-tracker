/**
 * Shown when `DATABASE_URL` is missing — the first screen a self-hoster sees.
 *
 * Errors say what happened and how to fix it (CLAUDE.md copy rules), which for a missing
 * database means the actual commands, in order.
 */

export function NeedsDatabase() {
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header>
        <h1 className="display text-2xl font-semibold">Connect a database</h1>
        <p className="text-muted mt-2 text-sm">
          Nothing is stored yet because <code>DATABASE_URL</code> is not set. Household data
          lives only in your own Neon database — it never ships in this repo.
        </p>
      </header>

      <ol className="border-hairline bg-surface space-y-4 border p-5 text-sm">
        <li>
          <p className="font-medium">1. Create a Neon Postgres database</p>
          <p className="text-muted mt-1">
            Any Postgres works. Copy its connection string.
          </p>
        </li>
        <li>
          <p className="font-medium">2. Add it to your environment</p>
          <pre className="figure border-hairline bg-paper mt-1 overflow-x-auto rounded border p-3 text-xs">
            cp .env.example .env{'\n'}# then set DATABASE_URL in .env
          </pre>
        </li>
        <li>
          <p className="font-medium">3. Create the tables</p>
          <pre className="figure border-hairline bg-paper mt-1 overflow-x-auto rounded border p-3 text-xs">
            pnpm db:migrate
          </pre>
        </li>
        <li>
          <p className="font-medium">4. Seed the card catalog</p>
          <pre className="figure border-hairline bg-paper mt-1 overflow-x-auto rounded border p-3 text-xs">
            pnpm seed
          </pre>
          <p className="text-muted mt-1">
            The catalog in <code>/catalog</code> starts empty. Every benefit needs an amount and
            a link to the issuer&rsquo;s terms before it can be added — see{' '}
            <code>catalog/README.md</code>.
          </p>
        </li>
        <li>
          <p className="font-medium">5. Reload this page</p>
          <p className="text-muted mt-1">You&rsquo;ll be asked to set up your household.</p>
        </li>
      </ol>
    </div>
  )
}
