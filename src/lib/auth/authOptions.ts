/**
 * NextAuth v4 configuration (credentials provider, JWT session).
 *
 * Adapts the prompt's Supabase Auth requirement to the sandbox stack.
 * The first-owner bootstrap lives in /api/auth/register; the credentials
 * provider here only authenticates existing users.
 */
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { loadSessionUser } from '@/lib/auth/permissions'

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/' }, // we render the login form inline at /
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(creds) {
        const email = creds?.email?.trim().toLowerCase()
        const password = creds?.password ?? ''
        if (!email || !password) return null

        const u = await db.user.findUnique({
          where: { email },
          include: { profile: true },
        })
        if (!u || !u.profile || !u.profile.isActive) return null

        const ok = await bcrypt.compare(password, u.passwordHash)
        if (!ok) return null

        return { id: u.id, email: u.email, name: u.profile.displayName } as any
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        const su = await loadSessionUser(token.userId as string)
        if (su) {
          ;(session.user as any).id = su.userId
          ;(session.user as any).supabaseUserUuid = su.supabaseUserUuid
          ;(session.user as any).profileId = su.profileId
          ;(session.user as any).businessId = su.businessId
          ;(session.user as any).roleId = su.roleId
          ;(session.user as any).roleName = su.roleName
          ;(session.user as any).displayName = su.displayName
          ;(session.user as any).permissions = Array.from(su.permissions)
        }
      }
      return session
    },
  },
}

export type AppSession = {
  user: {
    id: string
    supabaseUserUuid: string | null
    email: string
    name?: string | null
    profileId: string
    businessId: string
    roleId: string
    roleName: string
    displayName: string
    permissions: string[]
  }
}
