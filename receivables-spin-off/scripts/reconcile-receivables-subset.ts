#!/usr/bin/env tsx
/**
 * Reconcile key receivables/accounting metrics between:
 * - SOURCE_DATABASE_URL (original app DB)
 * - DATABASE_URL (spin-off DB)
 *
 * Output is printed to stdout and also written to ./reconciliation-report.json
 */

import { PrismaClient } from "@prisma/client"
import fs from "fs"

const SOURCE_DATABASE_URL = process.env.SOURCE_DATABASE_URL
const DEST_DATABASE_URL = process.env.DATABASE_URL

if (!SOURCE_DATABASE_URL) throw new Error("Missing SOURCE_DATABASE_URL")
if (!DEST_DATABASE_URL) throw new Error("Missing DATABASE_URL")

const now = new Date()
now.setHours(0, 0, 0, 0)

const source = new PrismaClient({
  datasources: { db: { url: SOURCE_DATABASE_URL } },
})
const dest = new PrismaClient({
  datasources: { db: { url: DEST_DATABASE_URL } },
})

function groupByDate(bills: Array<{ dueDate: Date | null; amount: number }>) {
  const map = new Map<string, { count: number; totalAmount: number }>()
  for (const b of bills) {
    if (!b.dueDate) continue
    const key = new Date(b.dueDate).toISOString().slice(0, 10)
    const cur = map.get(key) || { count: 0, totalAmount: 0 }
    cur.count += 1
    cur.totalAmount += b.amount || 0
    map.set(key, cur)
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dueDate, v]) => ({ dueDate, ...v }))
}

async function computeOutstanding(prisma: PrismaClient) {
  const bills = await prisma.bill.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ["PAID", "CANCELLED", "WRITTEN_OFF"] },
      dueDate: { lt: now },
    },
    select: { dueDate: true, amount: true },
  })

  const totalAmount = bills.reduce((sum, b) => sum + (b.amount || 0), 0)
  const byDueDate = groupByDate(bills)

  return { totalCount: bills.length, totalAmount, byDueDate }
}

async function computeFinderFees(prisma: PrismaClient) {
  const agg = await prisma.finderFee.aggregate({
    _sum: { finderFeeAmount: true, paidAmount: true, remainingAmount: true },
    _count: { _all: true },
  })

  return {
    totalCount: agg._count._all,
    totalFinderFeeAmount: agg._sum.finderFeeAmount ?? 0,
    totalPaidAmount: agg._sum.paidAmount ?? 0,
    totalRemainingAmount: agg._sum.remainingAmount ?? 0,
  }
}

async function computeCompensation(prisma: PrismaClient) {
  const agg = await prisma.compensationEntry.aggregate({
    _sum: { totalEarned: true, totalPaid: true, balance: true },
    _count: { _all: true },
  })

  return {
    totalEntries: agg._count._all,
    totalEarned: agg._sum.totalEarned ?? 0,
    totalPaid: agg._sum.totalPaid ?? 0,
    totalBalance: agg._sum.balance ?? 0,
  }
}

async function computeBalances(prisma: PrismaClient) {
  // Balance = sum(UserFinancialTransaction.amount)
  const group = await prisma.userFinancialTransaction.groupBy({
    by: ["userId"],
    _sum: { amount: true },
  })

  const entries = group
    .map((g) => ({ userId: g.userId, balance: g._sum.amount ?? 0 }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))

  return {
    userCountWithTx: entries.length,
    topByAbsBalance: entries.slice(0, 25),
  }
}

async function computeAttribution(prisma: PrismaClient) {
  const [snapshotCount, participantCount, backfilledCount] = await Promise.all([
    prisma.billAttributionSnapshot.count(),
    prisma.billAttributionParticipant.count(),
    prisma.billAttributionSnapshot.count({ where: { isBackfilled: true } }),
  ])
  return { snapshotCount, participantCount, backfilledCount }
}

async function main() {
  console.log("=== Reconciliation run ===")
  console.log(`now=${now.toISOString().slice(0, 10)}`)

  const [sourceOutstanding, destOutstanding] = await Promise.all([
    computeOutstanding(source),
    computeOutstanding(dest),
  ])

  const [sourceFinderFees, destFinderFees] = await Promise.all([
    computeFinderFees(source),
    computeFinderFees(dest),
  ])

  const [sourceComp, destComp] = await Promise.all([
    computeCompensation(source),
    computeCompensation(dest),
  ])

  const [sourceBalances, destBalances] = await Promise.all([
    computeBalances(source),
    computeBalances(dest),
  ])
  const [sourceAttribution, destAttribution] = await Promise.all([
    computeAttribution(source),
    computeAttribution(dest),
  ])

  const report = {
    runAt: new Date().toISOString(),
    now: now.toISOString().slice(0, 10),
    source: {
      outstanding: sourceOutstanding,
      finderFees: sourceFinderFees,
      compensationEntries: sourceComp,
      balances: sourceBalances,
      attribution: sourceAttribution,
    },
    dest: {
      outstanding: destOutstanding,
      finderFees: destFinderFees,
      compensationEntries: destComp,
      balances: destBalances,
      attribution: destAttribution,
    },
    diffs: {
      outstandingCount: destOutstanding.totalCount - sourceOutstanding.totalCount,
      outstandingAmount: destOutstanding.totalAmount - sourceOutstanding.totalAmount,
      finderFeeAmount: destFinderFees.totalFinderFeeAmount - sourceFinderFees.totalFinderFeeAmount,
      finderFeePaidAmount: destFinderFees.totalPaidAmount - sourceFinderFees.totalPaidAmount,
      compensationEarned: destComp.totalEarned - sourceComp.totalEarned,
      compensationPaid: destComp.totalPaid - sourceComp.totalPaid,
      compensationBalance: destComp.totalBalance - sourceComp.totalBalance,
      attributionSnapshots: destAttribution.snapshotCount - sourceAttribution.snapshotCount,
      attributionRows: destAttribution.participantCount - sourceAttribution.participantCount,
    },
  }

  console.log("\n--- Outstanding Bills ---")
  console.log("source:", sourceOutstanding)
  console.log("dest:  ", destOutstanding)

  console.log("\n--- Finder Fees ---")
  console.log("source:", sourceFinderFees)
  console.log("dest:  ", destFinderFees)

  console.log("\n--- Compensation Entries ---")
  console.log("source:", sourceComp)
  console.log("dest:  ", destComp)

  console.log("\n--- Balances (top 25 by abs) ---")
  console.log("source top:", sourceBalances.topByAbsBalance.slice(0, 5))
  console.log("dest top:  ", destBalances.topByAbsBalance.slice(0, 5))

  const outPath = "./reconciliation-report.json"
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8")
  console.log(`\nWrote ${outPath}`)

  await source.$disconnect()
  await dest.$disconnect()
}

main().catch(async (e) => {
  console.error("Reconciliation failed:", e)
  await source.$disconnect()
  await dest.$disconnect()
  process.exit(1)
})

