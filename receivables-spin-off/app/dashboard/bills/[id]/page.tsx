import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { BillStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SubmitInvoiceButton } from "@/components/invoices/SubmitInvoiceButton"
import { DownloadPdfButton } from "@/components/invoices/DownloadPdfButton"
import { BillAttributionEditor } from "@/components/invoices/BillAttributionEditor"
import { DeleteButton } from "@/components/shared/DeleteButton"
import { canEditInvoice } from "@/lib/permissions"
import { supportsInvoicePercentagePayouts } from "@/lib/invoice-percentage-payouts"
import { computeManagementFeeBaseSync, managementFeePoolDollars } from "@/lib/management-fee-helpers"
import { computeInvoiceNetAmountSync } from "@/lib/finder-fee-helpers"

async function addPercentagePayout(formData: FormData) {
  "use server"
  const billId = String(formData.get("billId") || "")
  const userId = String(formData.get("userId") || "")
  const amountRaw = Number(formData.get("amount") || 0)
  const notes = String(formData.get("notes") || "").trim()

  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") redirect(`/dashboard/bills/${billId}`)
  if (!supportsInvoicePercentagePayouts()) redirect(`/dashboard/bills/${billId}`)
  if (!billId || !userId || !Number.isFinite(amountRaw) || amountRaw <= 0) redirect(`/dashboard/bills/${billId}`)

  const bill = await prisma.bill.findUnique({
    where: { id: billId, deletedAt: null },
    select: { id: true, status: true },
  })
  if (!bill) redirect("/dashboard/bills")

  await (prisma as any).invoicePercentagePayout.create({
    data: {
      billId,
      userId,
      amount: amountRaw,
      notes: notes || null,
      createdBy: session.user.id,
    },
  })

  if (bill.status === BillStatus.PAID) {
    try {
      const { resyncFinderAndManagementFeesForPaidBill } = await import("@/lib/attribution-fee-resync")
      await resyncFinderAndManagementFeesForPaidBill(billId)
    } catch (error) {
      console.error("Failed to resync fees after adding percentage payout:", error)
    }
  }

  revalidatePath(`/dashboard/bills/${billId}`)
  redirect(`/dashboard/bills/${billId}`)
}

async function deletePercentagePayout(formData: FormData) {
  "use server"
  const billId = String(formData.get("billId") || "")
  const payoutId = String(formData.get("payoutId") || "")
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") redirect(`/dashboard/bills/${billId}`)
  if (!supportsInvoicePercentagePayouts()) redirect(`/dashboard/bills/${billId}`)

  const existing = await (prisma as any).invoicePercentagePayout.findUnique({
    where: { id: payoutId },
    select: { id: true, billId: true },
  })
  if (!existing || existing.billId !== billId) redirect(`/dashboard/bills/${billId}`)

  await (prisma as any).invoicePercentagePayout.delete({
    where: { id: payoutId },
  })

  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: { status: true },
  })
  if (bill?.status === BillStatus.PAID) {
    try {
      const { resyncFinderAndManagementFeesForPaidBill } = await import("@/lib/attribution-fee-resync")
      await resyncFinderAndManagementFeesForPaidBill(billId)
    } catch (error) {
      console.error("Failed to resync fees after deleting percentage payout:", error)
    }
  }

  revalidatePath(`/dashboard/bills/${billId}`)
  redirect(`/dashboard/bills/${billId}`)
}

export const dynamic = "force-dynamic"

async function markBillAsPaid(formData: FormData) {
  "use server"
  const billId = formData.get("billId") as string
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") redirect("/dashboard")

  await prisma.bill.update({
    where: { id: billId },
    data: {
      status: BillStatus.PAID,
      paidAt: new Date(),
      becameOutstandingAt: null,
      lastReminderSentAt: null,
      reminderCount: 0,
    },
  })
  try {
    const { runPaidInvoiceLedgerHooks } = await import("@/lib/invoice-paid-fees")
    await runPaidInvoiceLedgerHooks(billId)
  } catch (error) {
    console.error("Error updating paid-invoice compensation after mark paid:", error)
  }

  redirect(`/dashboard/bills/${billId}`)
}

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  let supportsAttributionSnapshots = false
  try {
    await prisma.bill.findFirst({
      include: {
        attributionSnapshots: {
          take: 1,
        },
      },
    } as any)
    supportsAttributionSnapshots = true
  } catch (probeError: any) {
  }

  const bill = await prisma.bill.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, email: true, company: true } },
      lead: { select: { id: true, name: true, email: true, company: true } },
      creator: { select: { id: true, name: true, email: true } },
      items: {
        select: { id: true, description: true, amount: true, quantity: true, unitPrice: true, isCredit: true },
        orderBy: { createdAt: "asc" },
      },
      ...(supportsAttributionSnapshots
        ? {
            attributionSnapshots: {
              orderBy: { version: "desc" },
              take: 1,
              include: {
                rows: {
                  include: {
                    user: {
                      select: { id: true, name: true, email: true },
                    },
                  },
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          }
        : {}),
    },
  })

  if (!bill) notFound()

  if (session.user.role === "CLIENT") {
    const client = await prisma.client.findFirst({ where: { email: session.user.email } })
    if (!client || bill.clientId !== client.id) return <div>Access denied</div>
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, canEditAllInvoices: true },
  })

  const currency = "EUR"
  const canEdit = user
    ? canEditInvoice(user, {
        createdBy: bill.createdBy,
        status: bill.status,
      })
    : false

  const canMarkPaid = (session.user.role === "ADMIN" || session.user.role === "MANAGER") && bill.status === BillStatus.APPROVED
  const canEditAttribution =
    (session.user.role === "ADMIN" || session.user.role === "MANAGER") &&
    (bill.status === BillStatus.DRAFT ||
      bill.status === BillStatus.SUBMITTED ||
      bill.status === BillStatus.APPROVED)
  const canManagePercentagePayouts = session.user.role === "ADMIN" || session.user.role === "MANAGER"
  const percentagePayoutsEnabled = supportsInvoicePercentagePayouts()

  const percentagePayouts = percentagePayoutsEnabled
    ? await (prisma as any).invoicePercentagePayout.findMany({
        where: { billId: bill.id },
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, email: true } },
          creator: { select: { id: true, name: true, email: true } },
        },
      })
    : []
  const payoutUsers = canManagePercentagePayouts
    ? await prisma.user.findMany({
        where: { role: { not: "CLIENT" } },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      })
    : []
  const percentagePayoutTotal = percentagePayouts.reduce((sum: number, row: any) => sum + (row.amount || 0), 0)
  const finderBaseBeforePayouts = computeInvoiceNetAmountSync({
    subtotal: bill.subtotal,
    discountPercent: bill.discountPercent,
    discountAmount: bill.discountAmount,
    items: bill.items.map((item) => ({ amount: item.amount, isCredit: item.isCredit })),
  })
  const finderBaseAfterPayouts = Math.max(0, finderBaseBeforePayouts - percentagePayoutTotal)
  const managementBaseBeforePayouts = computeManagementFeeBaseSync({
    subtotal: bill.subtotal,
    discountPercent: bill.discountPercent,
    discountAmount: bill.discountAmount,
    items: bill.items.map((item) => ({ amount: item.amount, isCredit: item.isCredit })),
  })
  const managementBaseAfterPayouts = Math.max(0, managementBaseBeforePayouts - percentagePayoutTotal)
  const managementPoolAfterPayouts = managementFeePoolDollars(managementBaseAfterPayouts)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Invoice {bill.invoiceNumber || bill.id}</h1>
          <p className="text-sm text-gray-600">
            {bill.client?.name || bill.lead?.name || "No client/lead"} · Status: {bill.status}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/bills">
            <Button variant="outline">Back</Button>
          </Link>
          <DownloadPdfButton billId={bill.id} />
          {canEdit && (
            <Link href={`/dashboard/bills/${bill.id}/edit`}>
              <Button variant="outline">Edit</Button>
            </Link>
          )}
          {bill.status === BillStatus.DRAFT && bill.createdBy === session.user.id && (
            <SubmitInvoiceButton invoiceId={bill.id} canSubmit={true} />
          )}
          {canMarkPaid && (
            <form action={markBillAsPaid}>
              <input type="hidden" name="billId" value={bill.id} />
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700">
                Mark as Paid
              </Button>
            </form>
          )}
          {(session.user.role === "ADMIN" || session.user.role === "MANAGER") && (
            <DeleteButton itemId={bill.id} itemType="invoice" itemName={bill.invoiceNumber || undefined} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>Total: {formatCurrency(bill.amount, currency)}</p>
            <p>Subtotal: {formatCurrency(bill.subtotal || bill.amount, currency)}</p>
            <p>Created: {formatDate(bill.createdAt)}</p>
            {bill.dueDate && <p>Due: {formatDate(bill.dueDate)}</p>}
            {bill.description && <p>Description: {bill.description}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Counterparty</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>Name: {bill.client?.name || bill.lead?.name || "-"}</p>
            <p>Email: {bill.client?.email || bill.lead?.email || "-"}</p>
            <p>Company: {bill.client?.company || bill.lead?.company || "-"}</p>
            <p>Created by: {bill.creator.name}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          {bill.items.length === 0 ? (
            <p className="text-sm text-gray-500">No line items.</p>
          ) : (
            <div className="space-y-2">
              {bill.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between border-b pb-2">
                  <div>
                    <p className="font-medium">{item.description}</p>
                    <p className="text-xs text-gray-500">
                      Qty: {item.quantity ?? "-"} · Unit: {item.unitPrice ?? "-"}
                    </p>
                  </div>
                  <p className={item.isCredit ? "text-red-600 font-semibold" : "font-semibold"}>
                    {formatCurrency(item.amount, currency)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Attribution Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <BillAttributionEditor
            billId={bill.id}
            editable={canEditAttribution}
            initialRows={(((bill as any).attributionSnapshots?.[0]?.rows) || []).map((row: any) => ({
              userId: row.userId,
              userName: row.user.name,
              role: row.role,
              splitPercent: row.splitPercent,
              fixedAmount: row.fixedAmount,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice-Linked Percentage Payouts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!percentagePayoutsEnabled ? (
            <p className="text-sm text-amber-700">
              Percentage payout entries are not available in this environment yet. Run schema migration first.
            </p>
          ) : (
            <>
              <div className="text-sm space-y-1">
                <p>Total deduction from fee base: {formatCurrency(percentagePayoutTotal, currency)}</p>
                <p>Finder fee base (after deduction): {formatCurrency(finderBaseAfterPayouts, currency)}</p>
                <p>Management fee base (after deduction): {formatCurrency(managementBaseAfterPayouts, currency)}</p>
                <p>Management 10% pool (after deduction): {formatCurrency(managementPoolAfterPayouts, currency)}</p>
              </div>

              {canManagePercentagePayouts && (
                <form action={addPercentagePayout} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                  <input type="hidden" name="billId" value={bill.id} />
                  <div>
                    <label className="text-xs text-gray-600">Recipient</label>
                    <select name="userId" required className="w-full border rounded px-2 py-1">
                      <option value="">Select user</option>
                      {payoutUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Amount</label>
                    <input
                      name="amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      className="w-full border rounded px-2 py-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Notes</label>
                    <input name="notes" type="text" className="w-full border rounded px-2 py-1" />
                  </div>
                  <Button type="submit">Add payout entry</Button>
                </form>
              )}

              {percentagePayouts.length === 0 ? (
                <p className="text-sm text-gray-500">No invoice-linked percentage payouts recorded.</p>
              ) : (
                <div className="space-y-2">
                  {percentagePayouts.map((row: any) => (
                    <div key={row.id} className="flex items-center justify-between border rounded px-3 py-2">
                      <div>
                        <p className="font-medium">
                          {row.user?.name || row.userId} · {formatCurrency(row.amount, currency)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {row.notes || "No notes"} · by {row.creator?.name || row.createdBy} on{" "}
                          {formatDate(row.createdAt)}
                        </p>
                      </div>
                      {canManagePercentagePayouts && (
                        <form action={deletePercentagePayout}>
                          <input type="hidden" name="billId" value={bill.id} />
                          <input type="hidden" name="payoutId" value={row.id} />
                          <Button type="submit" variant="outline">
                            Delete
                          </Button>
                        </form>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
