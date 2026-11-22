import { redirect } from 'next/navigation'
import { gateConfig } from '@/lib/gate/config'
import { isUnlocked } from '@/lib/gate/server'
import { safeNextPath } from '@/lib/gate/token'
import { UnlockForm } from './unlock-form'

export const dynamic = 'force-dynamic'

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const raw = (await searchParams).next
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw)

  // Already unlocked, or no gate on this deployment: nothing to do here.
  if (await isUnlocked()) redirect(next)

  const setupError =
    gateConfig(process.env).mode === 'misconfigured'
      ? 'The PIN isn’t set up on this deployment yet. Set HOUSEHOLD_PIN and UNLOCK_SECRET in the hosting environment, then redeploy.'
      : null

  return <UnlockForm next={next} setupError={setupError} />
}
