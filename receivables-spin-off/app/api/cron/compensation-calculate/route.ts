import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@prisma/client"
import { POST as calculateCompensationForUser } from "@/app/api/users/[id]/compensation/calculate/route"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1 // JS months are 0-based

    const periodStart = new Date(year, month - 1, 1)

    // Find all users with an active compensation scheme for the current month.
    const activeCompensations = await prisma.userCompensation.findMany({
      where: {
        effectiveFrom: { lte: periodStart },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
      },
      select: { userId: true },
    })

    const userIds = Array.from(new Set(activeCompensations.map((c) => c.userId)))

    // Ensure there is at least one admin to attribute created transactions.
    const admin = await prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    })

    if (!admin) {
      return NextResponse.json({ error: "No admin user found for cron attribution" }, { status: 500 })
    }

    let processed = 0
    let skipped = 0
    let failed = 0
    const failures: Array<{ userId: string; error: string }> = []

    for (const userId of userIds) {
      try {
        const req = new Request("http://localhost/api/cron/compensation-calculate", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-cron": "compensation-calculate",
            authorization: cronSecret ? `Bearer ${cronSecret}` : "",
          },
          body: JSON.stringify({ year, month, forceRecalculate: true }),
        })

        // This calls the same calculation logic as the admin endpoint.
        const res = await calculateCompensationForUser(req, {
          params: Promise.resolve({ id: userId }),
        })

        const json = await res.json().catch(() => null)
        if (res.status >= 400) {
          skipped++
          failures.push({
            userId,
            error: json?.error || `HTTP ${res.status}`,
          })
        } else {
          processed++
        }
      } catch (e: any) {
        failed++
        failures.push({ userId, error: e?.message || String(e) })
      }
    }

    return NextResponse.json({
      success: true,
      year,
      month,
      processed,
      failed,
      skipped,
      failures: failures.slice(0, 20),
      userCount: userIds.length,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: "Internal server error", message: error?.message || String(error) },
      { status: 500 }
    )
  }
}

