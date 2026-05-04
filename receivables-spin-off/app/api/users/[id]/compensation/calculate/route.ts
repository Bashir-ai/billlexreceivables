export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { UserRole, CompensationType } from "@prisma/client"
import { z } from "zod"
import { computeInvoiceNetAmountSync } from "@/lib/finder-fee-helpers"
import { managementFeeLineFromPool, managementFeePoolDollars } from "@/lib/management-fee-helpers"
import { computeMonthlyBaseSalaryForPeriod, firstYearBonusScale } from "@/lib/compensation-anchors"

function endOfMonth(year: number, month: number) {
  return new Date(year, month, 0, 23, 59, 59, 999)
}

function startOfMonth(year: number, month: number) {
  return new Date(year, month - 1, 1, 0, 0, 0, 0)
}

function bonusDueThisMonth(
  month: number,
  frequency?: "MONTHLY" | "QUARTERLY" | "YEARLY" | null,
  dueMonth?: number | null
) {
  const f = frequency || "MONTHLY"
  if (f === "MONTHLY") return true
  const anchor = dueMonth && dueMonth >= 1 && dueMonth <= 12 ? dueMonth : 12
  if (f === "YEARLY") return month === anchor
  return ((month - anchor + 12) % 3) === 0
}

const calculateSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  bonusMultiplier: z.number().min(0).nullable().optional(),
  forceRecalculate: z.boolean().optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cronSecret = process.env.CRON_SECRET

    let actingUserId: string | null = null
    let actingRole: UserRole | null = null

    const session = await getServerSession(authOptions)
    if (session) {
      actingUserId = session.user.id
      actingRole = session.user.role
    } else {
      const internalCronHeader = request.headers.get("x-internal-cron")
      const hasValidCronSecret =
        cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`

      // Allow the cron job to calculate compensation without a user session.
      if (internalCronHeader === "compensation-calculate" || hasValidCronSecret) {
      const admin = await prisma.user.findFirst({
        where: { role: UserRole.ADMIN },
        select: { id: true, role: true },
      })
      if (admin) {
        actingUserId = admin.id
        actingRole = admin.role
      }
    }
    }

    if (!actingUserId || actingRole !== UserRole.ADMIN) {
      return NextResponse.json({ error: "Forbidden - Admin access required" }, { status: 403 })
    }

    const { id } = await params
    const userId = id
    const body = await request.json()
    const validatedData = calculateSchema.parse(body)

    const { year, month, bonusMultiplier, forceRecalculate } = validatedData

    const periodStartForLookup = startOfMonth(year, month)
    const periodEndForLookup = endOfMonth(year, month)

    // Prefer compensation active at period start (month anchor), then fallback
    // to any record active during the period. This avoids mid-month overlap rows
    // accidentally overriding full-month salary calculations.
    let compensation = await prisma.userCompensation.findFirst({
      where: {
        userId,
        effectiveFrom: { lte: periodStartForLookup },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStartForLookup } }],
      },
      orderBy: { effectiveFrom: "desc" },
    })

    if (!compensation) {
      compensation = await prisma.userCompensation.findFirst({
        where: {
          userId,
          effectiveFrom: { lte: periodEndForLookup },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStartForLookup } }],
        },
        orderBy: { effectiveFrom: "desc" },
      })
    }

    if (!compensation) {
      return NextResponse.json({ error: "No active compensation found for this period" }, { status: 404 })
    }

    // Check if entry already exists
    const existingEntry = await prisma.compensationEntry.findUnique({
      where: {
        userId_periodYear_periodMonth: {
          userId,
          periodYear: year,
          periodMonth: month,
        },
      },
    })

    if (existingEntry && !forceRecalculate) {
      return NextResponse.json({ error: "Compensation entry already exists for this period" }, { status: 400 })
    }

    let totalEarned = 0
    let baseSalary = compensation.baseSalary ?? 0
    let bonusAmount: number | null = null
    let percentageEarnings: number | null = null
    const periodStart = startOfMonth(year, month)
    const periodEnd = endOfMonth(year, month)

    const effectiveStartRaw = new Date(compensation.effectiveFrom)
    const employmentStartRaw = (compensation as { employmentStartDate?: Date | null })
      .employmentStartDate
      ? new Date(
          (compensation as { employmentStartDate?: Date | null }).employmentStartDate as Date
        )
      : null

    // Monthly base: prorated to calendar days in the hire month (employment start), else legacy effectiveFrom.
    const fullMonthly = compensation.baseSalary ?? 0
    baseSalary = computeMonthlyBaseSalaryForPeriod({
      year,
      month,
      fullMonthlyBase: fullMonthly,
      employmentStartDate: employmentStartRaw,
      effectiveFrom: effectiveStartRaw,
    })

    const fy = firstYearBonusScale({
      year,
      month,
      employmentStartDate: employmentStartRaw,
      effectiveFrom: effectiveStartRaw,
    })

    const bonusIsDue = bonusDueThisMonth(
      month,
      ((compensation as any).bonusDueFrequency as any) || "MONTHLY",
      (compensation as any).bonusDueMonth ?? null
    )

    if (compensation.compensationType === CompensationType.SALARY_BONUS) {
      // Base salary + bonus + finder add-ons (SALARY_BONUS; "Salary + Bonus + Finder")
      const multiplier = bonusMultiplier ?? 0
      if (multiplier < 0 || (compensation.maxBonusMultiplier && multiplier > compensation.maxBonusMultiplier)) {
        return NextResponse.json({ 
          error: `Bonus multiplier must be between 0 and ${compensation.maxBonusMultiplier}` 
        }, { status: 400 })
      }
      bonusAmount = bonusIsDue ? baseSalary * multiplier * fy : 0

      const paidBills = await prisma.bill.findMany({
        where: {
          paidAt: { gte: periodStart, lte: periodEnd },
          status: "PAID",
          deletedAt: null,
        },
        include: {
          items: { select: { amount: true, isCredit: true } },
          attributionSnapshots: {
            orderBy: { version: "desc" },
            take: 1,
            include: { rows: true },
          },
        },
      })

      const attributionBasis = (bill: (typeof paidBills)[number]) =>
        computeInvoiceNetAmountSync({
          subtotal: bill.subtotal,
          discountPercent: bill.discountPercent,
          discountAmount: bill.discountAmount,
          items: bill.items,
        })

      const finderFromBills = paidBills.reduce((sum, bill) => {
        const latest = bill.attributionSnapshots[0]
        const row = latest?.rows.find((r) => r.userId === userId && r.role === "FINDER")
        if (!row) return sum
        const basis = attributionBasis(bill)
        return sum + basis * ((row.splitPercent || 0) / 100) + (row.fixedAmount || 0)
      }, 0)
      const finderEarnings = finderFromBills + (compensation.finderFeeFixedAmount || 0)
      percentageEarnings = finderEarnings
      totalEarned = baseSalary + bonusAmount + finderEarnings
    } else if (compensation.compensationType === CompensationType.PERCENTAGE_BASED) {
      // Percentage-based calculation (with optional fixed components)

      let projectTotalEarnings = 0
      let directWorkEarnings = 0

      // Get all eligibility records for this user and compensation
      const eligibilityRecords = await prisma.compensationEligibility.findMany({
        where: {
          userId,
          compensationId: compensation.id,
        },
      })

      // Create maps for quick lookup
      const projectEligibilityMap = new Map<string, boolean>()
      const clientEligibilityMap = new Map<string, boolean>()
      const billEligibilityMap = new Map<string, boolean>()

      for (const record of eligibilityRecords) {
        if (record.projectId) {
          projectEligibilityMap.set(record.projectId, record.isEligible)
        }
        if (record.clientId) {
          clientEligibilityMap.set(record.clientId, record.isEligible)
        }
        if (record.billId) {
          billEligibilityMap.set(record.billId, record.isEligible)
        }
      }

      // Helper function to check if a project is eligible
      const isProjectEligible = (project: any): boolean => {
        // Check project-specific eligibility first
        if (projectEligibilityMap.has(project.id)) {
          return projectEligibilityMap.get(project.id)!
        }
        // Check client-specific eligibility
        if (project.clientId && clientEligibilityMap.has(project.clientId)) {
          return clientEligibilityMap.get(project.clientId)!
        }
        // Default to eligible if no eligibility record exists (backward compatibility)
        return true
      }

      // Helper function to check if a bill is eligible
      const isBillEligible = (bill: any): boolean => {
        // Check bill-specific eligibility first
        if (billEligibilityMap.has(bill.id)) {
          return billEligibilityMap.get(bill.id)!
        }
        // If no bill-specific record, check project eligibility
        if (bill.projectId) {
          return isProjectEligible({ id: bill.projectId, clientId: null })
        }
        // Default to eligible
        return true
      }

      // Get projects user participated in (as manager or through timesheets)
      const userProjects = await prisma.project.findMany({
        where: {
          OR: [
            { projectManagers: { some: { userId } } },
            { timesheetEntries: { some: { userId, date: { gte: periodStart, lte: periodEnd } } } },
            { bills: { some: { items: { some: { personId: userId } } } } },
          ],
        },
        include: {
          proposal: {
            include: {
              items: true,
            },
          },
          bills: {
            where: {
              paidAt: { gte: periodStart, lte: periodEnd },
            },
            include: {
              items: true,
            },
          },
          timesheetEntries: {
            where: {
              userId,
              date: { gte: periodStart, lte: periodEnd },
            },
          },
        },
      })

      for (const project of userProjects) {
        // Check if project is eligible
        if (!isProjectEligible(project)) {
          continue // Skip this project
        }
        
        // Calculate project total value (from paid invoices that are eligible)
        // Note: Expenses are NEVER included in compensation calculations
        const projectTotal = project.bills
          .filter(bill => bill.paidAt && isBillEligible(bill))
          .reduce((sum, bill) => sum + bill.amount, 0)

        // Calculate direct work value (from timesheets and bill items)
        const directWork = project.timesheetEntries.reduce((sum, entry) => {
          return sum + (entry.hours * (entry.rate || 0))
        }, 0)

        // Also check bill items for this user (only from eligible bills)
        const billItemsValue = project.bills
          .filter(bill => isBillEligible(bill))
          .flatMap(bill => bill.items)
          .filter(item => item.personId === userId)
          .reduce((sum, item) => sum + item.amount, 0)

        const totalDirectWork = directWork + billItemsValue

        // Apply percentages based on compensation type
        if (compensation.percentageType === "PROJECT_TOTAL" || compensation.percentageType === "BOTH") {
          if (compensation.projectPercentage) {
            projectTotalEarnings += projectTotal * (compensation.projectPercentage / 100)
          }
        }

        if (compensation.percentageType === "DIRECT_WORK" || compensation.percentageType === "BOTH") {
          if (compensation.directWorkPercentage) {
            directWorkEarnings += totalDirectWork * (compensation.directWorkPercentage / 100)
          }
        }
      }

      const fixedProjectComponent =
        compensation.percentageType === "PROJECT_TOTAL" || compensation.percentageType === "BOTH"
          ? compensation.projectFixedAmount || 0
          : 0
      const fixedDirectComponent =
        compensation.percentageType === "DIRECT_WORK" || compensation.percentageType === "BOTH"
          ? compensation.directWorkFixedAmount || 0
          : 0

      percentageEarnings = projectTotalEarnings + directWorkEarnings + fixedProjectComponent + fixedDirectComponent
      totalEarned = percentageEarnings
    } else if (compensation.compensationType === CompensationType.SALARY_BONUS_FINDER_MANAGEMENT) {
      const periodStart = new Date(year, month - 1, 1)
      const periodEnd = new Date(year, month, 0, 23, 59, 59)
      const paidBills = await prisma.bill.findMany({
        where: {
          paidAt: { gte: periodStart, lte: periodEnd },
          status: "PAID",
          deletedAt: null,
        },
        include: {
          items: { select: { amount: true, isCredit: true } },
          attributionSnapshots: {
            orderBy: { version: "desc" },
            take: 1,
            include: { rows: true },
          },
        },
      })

      const attributionBasis = (bill: (typeof paidBills)[number]) =>
        computeInvoiceNetAmountSync({
          subtotal: bill.subtotal,
          discountPercent: bill.discountPercent,
          discountAmount: bill.discountAmount,
          items: bill.items,
        })

      const finderAmount = paidBills.reduce((sum, bill) => {
        const latest = bill.attributionSnapshots[0]
        const row = latest?.rows.find((r) => r.userId === userId && r.role === "FINDER")
        if (!row) return sum
        const basis = attributionBasis(bill)
        return sum + basis * ((row.splitPercent || 0) / 100) + (row.fixedAmount || 0)
      }, 0)
      const managementAmount = paidBills.reduce((sum, bill) => {
        const latest = bill.attributionSnapshots[0]
        const rows = (latest?.rows || []).filter(
          (r) =>
            r.userId === userId &&
            (r.role === "CLIENT_MANAGER" || r.role === "PROJECT_MANAGER")
        )
        if (rows.length === 0) return sum
        const basis = attributionBasis(bill)
        const pool = managementFeePoolDollars(basis)
        const roleAmount = rows.reduce(
          (rowSum, row) =>
            rowSum +
            managementFeeLineFromPool(
              pool,
              row.splitPercent || 0,
              row.fixedAmount || 0
            ),
          0
        )
        return sum + roleAmount
      }, 0)

      const rawFixed = bonusIsDue ? (compensation.bonusFixedAmount || 0) : 0
      const rawPct =
        bonusIsDue && (compensation.bonusPercent || 0) > 0
          ? (baseSalary * (compensation.bonusPercent || 0)) / 100
          : 0
      bonusAmount = (rawFixed + rawPct) * fy
      percentageEarnings = finderAmount + managementAmount
      totalEarned =
        baseSalary +
        bonusAmount +
        finderAmount +
        managementAmount +
        (compensation.finderFeeFixedAmount || 0) +
        (compensation.managementFeeFixedAmount || 0)
    }

    let entry
    if (existingEntry && forceRecalculate) {
      const preservedPaid = existingEntry.totalPaid || 0
      const updatedBalance = totalEarned - preservedPaid
      entry = await prisma.compensationEntry.update({
        where: { id: existingEntry.id },
        data: {
          compensationId: compensation.id,
          baseSalary,
          bonusMultiplier: bonusMultiplier ?? null,
          bonusAmount,
          percentageEarnings,
          totalEarned,
          totalPaid: preservedPaid,
          balance: updatedBalance,
          calculatedAt: new Date(),
        },
      })

      const existingCompTx = await prisma.userFinancialTransaction.findFirst({
        where: {
          userId,
          type: "COMPENSATION",
          relatedId: existingEntry.id,
          relatedType: "COMPENSATION_ENTRY",
        },
        orderBy: { createdAt: "asc" },
      })

      if (existingCompTx) {
        await prisma.userFinancialTransaction.update({
          where: { id: existingCompTx.id },
          data: {
            amount: totalEarned,
            transactionDate: periodEnd,
            description: `Compensation for ${year}-${month.toString().padStart(2, '0')}`,
          },
        })
      } else {
        await prisma.userFinancialTransaction.create({
          data: {
            userId,
            type: "COMPENSATION",
            relatedId: entry.id,
            relatedType: "COMPENSATION_ENTRY",
            amount: totalEarned,
            currency: "EUR",
            transactionDate: periodEnd,
            description: `Compensation for ${year}-${month.toString().padStart(2, '0')}`,
            createdBy: actingUserId,
          },
        })
      }
    } else {
      // Create compensation entry
      entry = await prisma.compensationEntry.create({
        data: {
          userId,
          compensationId: compensation.id,
          periodYear: year,
          periodMonth: month,
          baseSalary,
          bonusMultiplier: bonusMultiplier ?? null,
          bonusAmount,
          percentageEarnings,
          totalEarned,
          totalPaid: 0,
          balance: totalEarned,
          calculatedAt: new Date(),
        },
      })

      // Create transaction record
      await prisma.userFinancialTransaction.create({
        data: {
          userId,
          type: "COMPENSATION",
          relatedId: entry.id,
          relatedType: "COMPENSATION_ENTRY",
          amount: totalEarned,
          currency: "EUR", // TODO: Get from user settings
          transactionDate: periodEnd,
          description: `Compensation for ${year}-${month.toString().padStart(2, '0')}`,
          createdBy: actingUserId,
        },
      })
    }

    return NextResponse.json(
      {
        entry,
        debug: {
          selectedCompensationId: compensation.id,
          selectedCompensationType: compensation.compensationType,
          selectedEffectiveFrom: compensation.effectiveFrom,
          selectedEffectiveTo: compensation.effectiveTo,
          selectedBaseSalary: compensation.baseSalary,
          computedBaseSalary: baseSalary,
        },
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("Error calculating compensation:", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: error.message || "Failed to calculate compensation" },
      { status: 500 }
    )
  }
}
