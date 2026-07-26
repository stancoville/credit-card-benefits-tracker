import { redirect } from 'next/navigation'
import { getHousehold, isDatabaseConfigured } from '@/lib/app/queries'
import { NeedsDatabase } from '@/components/needs-database'
import { SetupForm } from './setup-form'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  if (!isDatabaseConfigured()) return <NeedsDatabase />

  const household = await getHousehold()
  if (household) redirect('/cards')
  return <SetupForm />
}
