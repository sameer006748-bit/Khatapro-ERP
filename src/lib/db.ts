/**
 * Local-development Prisma client bound to db/custom.db (SQLite).
 *
 * IMPORTANT: This client is intended for LOCAL DEVELOPMENT ONLY.
 * It is NOT a Vercel production datastore. Vercel serverless
 * functions do not persist local SQLite files between invocations.
 *
 * When Supabase is configured (NEXT_PUBLIC_SUPABASE_URL + keys),
 * authentication and all production data access route through
 * Supabase Auth + PostgREST, not through this client.
 *
 * SQLite usage is restricted to:
 *  - local offline/dev workflows
 *  - fallback paths gated by isSupabaseConfigured()
 *
 * Do NOT assume DATABASE_URL presence implies safe production use;
 * the app must still route auth/session through Supabase when
 * the Supabase env vars are present.
 */
import 'server-only'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
