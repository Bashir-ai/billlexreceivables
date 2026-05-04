"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatCurrency } from "@/lib/utils"

type MonthlyPayload = {
  months: Array<{
    monthKey: string
    monthLabel: string
    issuedCount: number
    invoicedAmount: number
    paidAmount: number
  }>
  totals: {
    issuedCount: number
    invoicedAmount: number
    paidAmount: number
  }
}

type OutstandingPayload = {
  asOf: string
  outstandingTotal: number
  outstandingServices: number
  outstandingExpenses: number
  receivedYtd: number
}

function dateInputValue(d: Date) {
  return d.toISOString().slice(0, 10)
}

export function InvoiceAnalyticsPanel() {
  const now = new Date()
  const [monthlyStart, setMonthlyStart] = useState(dateInputValue(new Date(now.getFullYear(), now.getMonth() - 11, 1)))
  const [monthlyEnd, setMonthlyEnd] = useState(dateInputValue(now))
  const [outstandingAsOf, setOutstandingAsOf] = useState(dateInputValue(now))
  const [outstandingYear, setOutstandingYear] = useState(String(now.getFullYear()))

  const [monthly, setMonthly] = useState<MonthlyPayload | null>(null)
  const [outstanding, setOutstanding] = useState<OutstandingPayload | null>(null)
  const [loadingMonthly, setLoadingMonthly] = useState(false)
  const [loadingOutstanding, setLoadingOutstanding] = useState(false)

  useEffect(() => {
    setLoadingMonthly(true)
    const q = new URLSearchParams({ startDate: monthlyStart, endDate: monthlyEnd })
    fetch(`/api/dashboard/invoice-stats?${q.toString()}`)
      .then((r) => r.json())
      .then((data) => setMonthly(data))
      .finally(() => setLoadingMonthly(false))
  }, [monthlyStart, monthlyEnd])

  useEffect(() => {
    setLoadingOutstanding(true)
    const q = new URLSearchParams({ asOfDate: outstandingAsOf, ytdYear: outstandingYear })
    fetch(`/api/dashboard/outstanding-stats?${q.toString()}`)
      .then((r) => r.json())
      .then((data) => setOutstanding(data))
      .finally(() => setLoadingOutstanding(false))
  }, [outstandingAsOf, outstandingYear])

  const maxAmount = useMemo(
    () => Math.max(1, ...(monthly?.months || []).map((m) => Math.max(m.invoicedAmount, m.paidAmount))),
    [monthly]
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Invoice Activity (Monthly)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input type="date" value={monthlyStart} onChange={(e) => setMonthlyStart(e.target.value)} />
            <Input type="date" value={monthlyEnd} onChange={(e) => setMonthlyEnd(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Invoices issued</p>
              <p className="text-lg font-semibold">{monthly?.totals.issuedCount ?? 0}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Amount invoiced</p>
              <p className="text-lg font-semibold">{formatCurrency(monthly?.totals.invoicedAmount ?? 0)}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-muted-foreground">Amount paid</p>
              <p className="text-lg font-semibold">{formatCurrency(monthly?.totals.paidAmount ?? 0)}</p>
            </div>
          </div>
          {loadingMonthly ? (
            <p className="text-sm text-muted-foreground">Loading monthly metrics...</p>
          ) : (
            <div className="space-y-2">
              {(monthly?.months || []).map((m) => (
                <div key={m.monthKey} className="text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span>{m.monthLabel}</span>
                    <span>{m.issuedCount} issued</span>
                  </div>
                  <div className="grid grid-cols-[1fr_88px] gap-2 items-center">
                    <div className="h-2 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${(m.invoicedAmount / maxAmount) * 100}%` }} />
                    </div>
                    <span className="text-right">{formatCurrency(m.invoicedAmount)}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_88px] gap-2 items-center">
                    <div className="h-2 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${(m.paidAmount / maxAmount) * 100}%` }} />
                    </div>
                    <span className="text-right">{formatCurrency(m.paidAmount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Collections and Outstanding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input type="date" value={outstandingAsOf} onChange={(e) => setOutstandingAsOf(e.target.value)} />
            <Input
              type="number"
              min="2000"
              max="2100"
              step="1"
              value={outstandingYear}
              onChange={(e) => setOutstandingYear(e.target.value)}
              placeholder="YTD year"
            />
          </div>
          {loadingOutstanding ? (
            <p className="text-sm text-muted-foreground">Loading outstanding metrics...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded border p-3 sm:col-span-2">
                <p className="text-muted-foreground">Outstanding invoices total</p>
                <p className="text-lg font-semibold">{formatCurrency(outstanding?.outstandingTotal ?? 0)}</p>
              </div>
              <div className="rounded border p-3">
                <p className="text-muted-foreground">Outstanding services</p>
                <p className="text-lg font-semibold">{formatCurrency(outstanding?.outstandingServices ?? 0)}</p>
              </div>
              <div className="rounded border p-3">
                <p className="text-muted-foreground">Outstanding expenses</p>
                <p className="text-lg font-semibold">{formatCurrency(outstanding?.outstandingExpenses ?? 0)}</p>
              </div>
              <div className="rounded border p-3 sm:col-span-2">
                <p className="text-muted-foreground">Amount received YTD</p>
                <p className="text-lg font-semibold">{formatCurrency(outstanding?.receivedYtd ?? 0)}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

