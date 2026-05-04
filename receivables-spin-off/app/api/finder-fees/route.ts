import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import { getFinderFeesForUser } from "@/lib/finder-fee-helpers"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId")
    const status = searchParams.get("status") as "PENDING" | "PARTIALLY_PAID" | "PAID" | null
    const clientId = searchParams.get("clientId")
    const startDate = searchParams.get("startDate") ? new Date(searchParams.get("startDate")!) : undefined
    const endDate = searchParams.get("endDate") ? new Date(searchParams.get("endDate")!) : undefined

    // EXTERNAL users can only see their own fees
    // Admins can see any user's fees if userId is provided, otherwise their own
    // Other users can only see their own fees
    let targetUserId = session.user.id
    if ((session.user.role === UserRole.ADMIN || session.user.role === UserRole.MANAGER) && userId) {
      targetUserId = userId
    } else if (session.user.role === "EXTERNAL" && userId && userId !== session.user.id) {
      return NextResponse.json(
        { error: "Forbidden - External users can only view their own finder fees" },
        { status: 403 }
      )
    }

    const options: {
      status?: "PENDING" | "PARTIALLY_PAID" | "PAID"
      clientId?: string
      startDate?: Date
      endDate?: Date
    } = {}

    if (status) {
      options.status = status
    }
    if (clientId) {
      options.clientId = clientId
    }
    if (startDate) {
      options.startDate = startDate
    }
    if (endDate) {
      options.endDate = endDate
    }

    const finderFees = await getFinderFeesForUser(targetUserId, options)

    return NextResponse.json(finderFees)
  } catch (error) {
    console.error("Error fetching finder fees:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}



