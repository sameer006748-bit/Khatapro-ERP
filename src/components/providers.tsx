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
