import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "./prisma"
import bcrypt from "bcryptjs"

/** Re-read role from DB periodically so promoted/demoted users get correct API access without signing out. */
const ROLE_REFRESH_MS = 60_000

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        })

        if (!user) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          timezone: user.timezone || "UTC",
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.timezone = (user as any).timezone || "UTC"
        token.roleRefreshedAt = Date.now()
        return token
      }

      const id = token.id as string | undefined
      const last = typeof token.roleRefreshedAt === "number" ? token.roleRefreshedAt : 0
      if (id && Date.now() - last > ROLE_REFRESH_MS) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id },
            select: { role: true, timezone: true },
          })
          if (dbUser) {
            token.role = dbUser.role
            if (dbUser.timezone) token.timezone = dbUser.timezone
          }
          token.roleRefreshedAt = Date.now()
        } catch {
          // Keep existing token on transient DB errors
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as any
        session.user.timezone = (token.timezone as string) || "UTC"
      }
      return session
    }
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET || (
    process.env.NODE_ENV === "production" 
      ? "build-time-placeholder-will-be-replaced-at-runtime"
      : "development-secret-change-in-production"
  ),
}






