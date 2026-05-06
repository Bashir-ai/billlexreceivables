import { UserRole } from "@prisma/client"
import "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: UserRole
      timezone?: string
    }
  }

  interface User {
    id: string
    email: string
    name: string
    role: UserRole
    timezone?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    role: UserRole
    timezone?: string
    /** ms since epoch — used to throttle DB role refresh */
    roleRefreshedAt?: number
  }
}









