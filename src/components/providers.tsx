'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            // Default staleTime so navigating between pages doesn't refetch
            // every query on each mount (previously 0 → refetch storm on every
            // navigation). Individual hooks can still override.
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  )

  return (
    <SessionProvider>
      <QueryClientProvider client={client}>
        {/* Light is the default. enableSystem lets users who explicitly prefer
            dark get it; we do NOT force light, so OS preference still wins after
            first paint. */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}
