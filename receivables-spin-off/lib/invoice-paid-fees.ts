/**
 * Side effects when an invoice becomes PAID (finder + management fee lines, compensation refresh).
 */
export async function runPaidInvoiceLedgerHooks(billId: string): Promise<void> {
  const { calculateAndCreateFinderFees } = await import("@/lib/finder-fee-helpers")
  const { calculateAndCreateManagementFees } = await import("@/lib/management-fee-helpers")
  await calculateAndCreateFinderFees(billId)
  await calculateAndCreateManagementFees(billId)
  const { refreshCompensationForCurrentPeriod } = await import("@/lib/compensation-refresh")
  await refreshCompensationForCurrentPeriod()
}
