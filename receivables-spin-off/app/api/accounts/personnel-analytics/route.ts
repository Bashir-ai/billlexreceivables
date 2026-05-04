export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getPersonnelAnalytics } from "@/lib/accounts-analytics"
import { UserRole } from "@prisma/client"

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")
  const requestedUserId = searchParams.get("userId")

  const isManagerScope =
    session.user.role === UserRole.ADMIN || session.user.role === UserRole.MANAGER
  const targetUserId = isManagerScope ? requestedUserId : session.user.id

  const data = await getPersonnelAnalytics(
    {
      viewerRole: session.user.role,
      viewerUserId: session.user.id,
      targetUserId,
    },
    { startDate, endDate }
  )

  return NextResponse.json(data)
}

