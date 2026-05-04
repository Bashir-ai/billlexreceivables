import { CompensationType } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { POST as calculateCompensationForUser } from "@/app/api/users/[id]/compensation/calculate/route"

export async function refreshCompensationForCurrentPeriod(): Promise<void> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const periodStart = new Date(year, month - 1, 1)

  const activeCompensations = await prisma.userCompensation.findMany({
    where: {
      compensationType: {
        in: [
          CompensationType.PERCENTAGE_BASED,
          CompensationType.SALARY_BONUS_FINDER_MANAGEMENT,
        ],
      },
      effectiveFrom: { lte: periodStart },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
    },
    select: { userId: true },
  })

  const userIds = Array.from(new Set(activeCompensations.map((c) => c.userId)))
  for (const userId of userIds) {
    const req = new Request("http://localhost/internal/comp-refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-cron": "compensation-calculate",
        ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
      },
      body: JSON.stringify({ year, month, forceRecalculate: true }),
    })
    await calculateCompensationForUser(req, { params: Promise.resolve({ id: userId }) })
  }
}
