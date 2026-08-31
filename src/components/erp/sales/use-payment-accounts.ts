'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetchJson } from '@/lib/api-client'
import {
  selectActivePaymentAccounts,
  type BusinessAccountSourceRow,
} from '@/lib/sales/payment-accounts'

type BusinessAccountsResponse = { rows: BusinessAccountSourceRow[] }

/** One cached, supported payment-account source shared by every sale channel. */
export function usePaymentAccounts() {
  const query = useQuery<BusinessAccountsResponse>({
    queryKey: ['business-accounts'],
    queryFn: ({ signal }) => apiFetchJson<BusinessAccountsResponse>(
      '/api/setup/business-accounts',
      { signal },
    ),
    staleTime: 300_000,
  })

  const accounts = useMemo(
    () => selectActivePaymentAccounts(query.data?.rows ?? []),
    [query.data?.rows],
  )

  return { ...query, accounts }
}
