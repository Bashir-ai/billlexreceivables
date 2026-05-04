"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatCurrency } from "@/lib/utils"

interface ManagementFeeRow {
  id: string
  bill: {
    id: string
    invoiceNumber: string | null
    amount: number
  }
  client: {
    id: string
    name: string
    company: string | null
  }
  feeAmount: number
  paidAmount: number
  remainingAmount: number
  status: "PENDING" | "PARTIALLY_PAID" | "PAID"
  role: string
}

export default function RecordManagementFeePaymentPage() {
  const router = useRouter()
  const params = useParams()
  const { data: session } = useSession()
  const managementFeeId = params.id as string
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [fee, setFee] = useState<ManagementFeeRow | null>(null)
  const [formData, setFormData] = useState({
    amount: "",
    paymentDate: new Date().toISOString().split("T")[0],
    notes: "",
  })

  useEffect(() => {
    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "MANAGER")) {
      router.push("/dashboard/accounts")
      return
    }

    fetch(`/api/management-fees/${managementFeeId}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) {
            setError("Management fee not found")
            setLoading(false)
            return
          }
          throw new Error("Failed to fetch management fee")
        }
        return res.json()
      })
      .then((row) => {
        if (row) {
          setFee(row)
          setFormData((prev) => ({
            ...prev,
            amount: row.remainingAmount > 0 ? row.remainingAmount.toString() : "",
          }))
        }
        setLoading(false)
      })
      .catch(() => {
        setError("Failed to load management fee")
        setLoading(false)
      })
  }, [session, managementFeeId, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    const amount = parseFloat(formData.amount)
    if (isNaN(amount) || amount <= 0) {
      setError("Please enter a valid payment amount greater than 0")
      setSubmitting(false)
      return
    }

    try {
      const response = await fetch(`/api/management-fees/${managementFeeId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          paymentDate: formData.paymentDate,
          notes: formData.notes || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.message || data.error || "Failed to record payment")
      } else {
        router.push("/dashboard/accounts")
      }
    } catch {
      setError("An error occurred. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div>Loading...</div>
  }

  if (!fee) {
    return <div>{error || "Management fee not found"}</div>
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Record Payment</h1>
      <Card>
        <CardHeader>
          <CardTitle>Management Fee Payment</CardTitle>
          <CardDescription>
            Invoice: {fee.bill.invoiceNumber || fee.bill.id} — Client: {fee.client.name} — Role:{" "}
            {fee.role.replace("_", " ")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Fee amount:</span>
              <span className="font-semibold">{formatCurrency(fee.feeAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Paid so far:</span>
              <span className="font-semibold">{formatCurrency(fee.paidAmount)}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-gray-600">Remaining:</span>
              <span className="font-semibold">{formatCurrency(fee.remainingAmount)}</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Payment amount *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                max={fee.remainingAmount}
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                required
              />
              <p className="text-sm text-gray-500">Maximum: {formatCurrency(fee.remainingAmount)}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentDate">Payment date *</Label>
              <Input
                id="paymentDate"
                type="date"
                value={formData.paymentDate}
                onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                placeholder="Optional payment notes..."
              />
            </div>

            {error && <div className="text-sm text-destructive">{error}</div>}

            <div className="flex space-x-4">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Recording..." : "Record payment"}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
