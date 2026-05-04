export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  canViewPayrollOps,
  collectionAgeBucket,
  daysPastDue,
  filterOutstandingInvoicesForUser,
  getOperationsCounts,
  PAYROLL_EPSILON,
} from "@/lib/operations"

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    if (session.user.role === UserRole.CLIENT) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const countsOnly = searchParams.get("countsOnly") === "1" || searchParams.get("countsOnly") === "true"

    const userId = session.user.id
    const role = session.user.role

    if (countsOnly) {
      const counts = await getOperationsCounts(userId, role)
      return NextResponse.json(counts)
    }

    const invoices = await filterOutstandingInvoicesForUser(userId, role)
    const collections = invoices.map((inv) => {
      const due = inv.dueDate ? new Date(inv.dueDate) : new Date()
      const dDays = inv.dueDate ? daysPastDue(due) : 0
      const clientOrLead = inv.client || inv.lead
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: inv.amount,
        dueDate: inv.dueDate?.toISOString() ?? null,
        becameOutstandingAt: inv.becameOutstandingAt?.toISOString() ?? null,
        status: inv.status,
        daysPastDue: dDays,
        ageBucket: collectionAgeBucket(dDays),
        client: clientOrLead
          ? {
              id: ("id" in clientOrLead && clientOrLead.id) ? String(clientOrLead.id) : null,
              name: clientOrLead.name,
              company: "company" in clientOrLead ? clientOrLead.company : null,
            }
          : null,
      }
    })

    let payroll:
      | {
          rows: Array<{
            entryId: string
            balance: number
            totalEarned: number
            totalPaid: number
            periodYear: number
            periodMonth: number
            user: { id: string; name: string; email: string }
          }>
          totalOwed: number
        }
      | undefined

    if (canViewPayrollOps(role)) {
      const entries = await prisma.compensationEntry.findMany({
        where: { balance: { gt: PAYROLL_EPSILON } },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ balance: "desc" }],
      })
      payroll = {
        rows: entries.map((e) => ({
          entryId: e.id,
          balance: e.balance,
          totalEarned: e.totalEarned,
          totalPaid: e.totalPaid,
          periodYear: e.periodYear,
          periodMonth: e.periodMonth,
          user: e.user,
        })),
        totalOwed: entries.reduce((s, e) => s + e.balance, 0),
      }
    }

    const counts = await getOperationsCounts(userId, role)

    return NextResponse.json({
      collections,
      payroll,
      counts,
    })
  } catch (error: any) {
    console.error("GET /api/operations:", error)
    return NextResponse.json(
      { error: "Failed to load operations", message: error?.message || String(error) },
      { status: 500 }
    )
  }
}
