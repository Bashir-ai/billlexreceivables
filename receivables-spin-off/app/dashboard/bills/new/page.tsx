"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/utils"

function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data
  }
  return []
}

type AttributionRole = "FINDER" | "CLIENT_MANAGER" | "PROJECT_MANAGER"

type LocalAttributionRow = {
  userId: string
  role: AttributionRole
  splitPercent: number
  fixedAmount: number | null
}

function buildDefaultAttributionFromClient(client: Record<string, unknown>): LocalAttributionRow[] {
  const rows: LocalAttributionRow[] = []
  const finders = (client.finders as unknown[]) || []
  for (const raw of finders) {
    const f = raw as Record<string, unknown>
    const uid = (f.userId as string) || ((f.user as Record<string, unknown>)?.id as string)
    if (!uid) continue
    rows.push({
      userId: uid,
      role: "FINDER",
      splitPercent: (f.finderFeePercent as number) || 0,
      fixedAmount: null,
    })
  }

  const splits = (client.managementSplits as unknown[]) || []
  const hasClientManagerSplit = splits.some(
    (s) => ((s as Record<string, unknown>).role as string) === "CLIENT_MANAGER"
  )
  for (const raw of splits) {
    const s = raw as Record<string, unknown>
    const uid = (s.userId as string) || ((s.user as Record<string, unknown>)?.id as string)
    if (!uid) continue
    const role = s.role === "PROJECT_MANAGER" ? "PROJECT_MANAGER" : "CLIENT_MANAGER"
    rows.push({
      userId: uid,
      role,
      splitPercent: (s.splitPercent as number) || 0,
      fixedAmount: (s.fixedAmount as number | null | undefined) ?? null,
    })
  }

  const cmId = client.clientManagerId as string | null | undefined
  if (!hasClientManagerSplit && cmId) {
    rows.push({
      userId: cmId,
      role: "CLIENT_MANAGER",
      splitPercent: 100,
      fixedAmount: null,
    })
  }

  return rows
}

export default function NewBillPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [clients, setClients] = useState<Array<{ id: string; name: string; company?: string | null }>>([])
  const [leads, setLeads] = useState<Array<{ id: string; name: string; company?: string | null }>>([])
  const [formData, setFormData] = useState({
    clientId: "",
    leadId: "",
    subtotal: "",
    description: "",
    paymentDetailsId: "",
    taxInclusive: false,
    taxRate: "0",
    discountPercent: "",
    discountAmount: "",
    dueDate: "",
  })
  const [calculatedAmount, setCalculatedAmount] = useState(0)
  const [paymentDetails, setPaymentDetails] = useState<Array<{ id: string; name: string; isDefault: boolean }>>([])
  const [staffUsers, setStaffUsers] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [useClientAttributionDefaults, setUseClientAttributionDefaults] = useState(true)
  const [defaultAttributionRows, setDefaultAttributionRows] = useState<LocalAttributionRow[]>([])
  const [attributionRows, setAttributionRows] = useState<LocalAttributionRow[]>([])

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((result) => {
        setClients(toArray<{ id: string; name: string; company?: string | null }>(result))
      })
      .catch(console.error)
    
    fetch("/api/leads")
      .then((res) => res.json())
      .then((result) => {
        const rows = toArray<any>(result)
        setLeads(rows.filter((l) => !l.deletedAt && !l.archivedAt))
      })
      .catch(console.error)
    
    fetch("/api/payment-details")
      .then((res) => res.json())
      .then((result) => {
        const data = toArray<{ id: string; name: string; isDefault: boolean }>(result)
        setPaymentDetails(data)
        // Set default payment details if available
        const defaultPd = data.find((pd) => pd.isDefault)
        if (defaultPd) {
          setFormData(prev => ({ ...prev, paymentDetailsId: defaultPd.id }))
        }
      })
      .catch(console.error)

    fetch("/api/users")
      .then((res) => res.json())
      .then((data: Array<{ id: string; name: string; email: string; role: string }>) => {
        setStaffUsers((Array.isArray(data) ? data : []).filter((u) => u.role !== "CLIENT"))
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (!formData.clientId) {
      setDefaultAttributionRows([])
      setAttributionRows([])
      return
    }

    let cancelled = false
    fetch(`/api/clients/${formData.clientId}`)
      .then((res) => res.json())
      .then((client) => {
        if (cancelled || !client?.id) return
        const built = buildDefaultAttributionFromClient(client as Record<string, unknown>)
        setDefaultAttributionRows(built)
      })
      .catch(console.error)

    return () => {
      cancelled = true
    }
  }, [formData.clientId])

  useEffect(() => {
    if (useClientAttributionDefaults) {
      setAttributionRows(defaultAttributionRows.map((r) => ({ ...r })))
    }
  }, [useClientAttributionDefaults, defaultAttributionRows])

  // Calculate totals when tax/discount changes
  useEffect(() => {
    let subtotal = parseFloat(formData.subtotal) || 0
    const taxRate = parseFloat(formData.taxRate) || 0
    const discountPercent = parseFloat(formData.discountPercent) || 0
    const discountAmount = parseFloat(formData.discountAmount) || 0

    // Calculate discount
    let discountValue = 0
    if (discountPercent > 0) {
      discountValue = (subtotal * discountPercent) / 100
    } else if (discountAmount > 0) {
      discountValue = discountAmount
    }

    const afterDiscount = subtotal - discountValue

    // Calculate tax and final amount
    let finalAmount = afterDiscount
    if (taxRate > 0) {
      if (formData.taxInclusive) {
        // Tax is included, so final amount is afterDiscount
        finalAmount = afterDiscount
      } else {
        // Tax is added on top
        const taxAmount = (afterDiscount * taxRate) / 100
        finalAmount = afterDiscount + taxAmount
      }
    }

    setCalculatedAmount(finalAmount)
  }, [formData.subtotal, formData.taxRate, formData.taxInclusive, formData.discountPercent, formData.discountAmount])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    
    // Validate that either clientId or leadId is provided
    if (!formData.clientId && !formData.leadId) {
      setError("Please select either a client or a lead")
      return
    }
    
    if (
      formData.clientId &&
      !useClientAttributionDefaults &&
      !attributionRows.some((r) => r.userId.trim() !== "")
    ) {
      setError("Add at least one attribution row with a user, or choose client defaults.")
      return
    }

    setLoading(true)

    try {
      const payload: Record<string, unknown> = {
        clientId: formData.clientId || undefined,
        leadId: formData.leadId || undefined,
        subtotal: formData.subtotal ? parseFloat(formData.subtotal) : undefined,
        description: formData.description || undefined,
        paymentDetailsId: formData.paymentDetailsId || undefined,
        taxInclusive: formData.taxInclusive,
        taxRate: formData.taxRate ? parseFloat(formData.taxRate) : null,
        discountPercent: formData.discountPercent ? parseFloat(formData.discountPercent) : null,
        discountAmount: formData.discountAmount ? parseFloat(formData.discountAmount) : null,
        dueDate: formData.dueDate || undefined,
      }

      if (formData.clientId && !useClientAttributionDefaults) {
        payload.attributionRows = attributionRows
          .filter((r) => r.userId.trim() !== "")
          .map((r) => ({
            userId: r.userId,
            role: r.role,
            splitPercent: r.splitPercent || 0,
            fixedAmount: r.fixedAmount ?? null,
          }))
      }

      const response = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || "Failed to create invoice")
      } else {
        const bill = await response.json()
        router.push(`/dashboard/bills/${bill.id}`)
      }
    } catch (err) {
      setError("An error occurred. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const updateAttrRow = (index: number, patch: Partial<LocalAttributionRow>) => {
    setAttributionRows((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
  }

  const addAttrRow = () => {
    setAttributionRows((prev) => [
      ...prev,
      { userId: "", role: "FINDER", splitPercent: 0, fixedAmount: null },
    ])
  }

  const removeAttrRow = (index: number) => {
    setAttributionRows((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Create New Invoice</h1>
      <Card>
        <CardHeader>
          <CardTitle>Invoice Information</CardTitle>
          <CardDescription>Enter the invoice details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clientId">Client</Label>
                <Select
                  id="clientId"
                  value={formData.clientId}
                  onChange={(e) => {
                    setUseClientAttributionDefaults(true)
                    setFormData({ ...formData, clientId: e.target.value, leadId: "" })
                  }}
                >
                  <option value="">Select a client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} {client.company ? `(${client.company})` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="leadId">Lead</Label>
                <Select
                  id="leadId"
                  value={formData.leadId}
                  onChange={(e) => setFormData({ ...formData, leadId: e.target.value, clientId: "" })}
                >
                  <option value="">Select a lead</option>
                  {leads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name} {lead.company ? `(${lead.company})` : ""}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {!formData.clientId && !formData.leadId && (
              <p className="text-sm text-red-600">Please select either a client or a lead</p>
            )}

            {formData.clientId && (
              <Card className="border-muted">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Invoice attribution</CardTitle>
                  <CardDescription>
                    Finder and management splits lock on this invoice. Defaults match the client record (including
                    general client manager when no manager split is set).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="attrMode"
                        checked={useClientAttributionDefaults}
                        onChange={() => setUseClientAttributionDefaults(true)}
                      />
                      Use client defaults
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="attrMode"
                        checked={!useClientAttributionDefaults}
                        onChange={() => setUseClientAttributionDefaults(false)}
                      />
                      Customize attribution for this invoice
                    </label>
                  </div>

                  {!useClientAttributionDefaults && (
                    <div className="space-y-3">
                      {attributionRows.map((row, index) => (
                        <div
                          key={`attr-${index}`}
                          className="grid grid-cols-1 md:grid-cols-5 gap-2 border rounded-md p-3"
                        >
                          <div className="space-y-1">
                            <Label className="text-xs">User</Label>
                            <Select
                              value={row.userId}
                              onChange={(e) => updateAttrRow(index, { userId: e.target.value })}
                            >
                              <option value="">Select…</option>
                              {staffUsers.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name} ({u.email})
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Role</Label>
                            <Select
                              value={row.role}
                              onChange={(e) =>
                                updateAttrRow(index, { role: e.target.value as AttributionRole })
                              }
                            >
                              <option value="FINDER">Finder</option>
                              <option value="CLIENT_MANAGER">Client manager</option>
                              <option value="PROJECT_MANAGER">Project manager</option>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Split %</Label>
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step={0.01}
                              value={row.splitPercent}
                              onChange={(e) =>
                                updateAttrRow(index, { splitPercent: parseFloat(e.target.value) || 0 })
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Fixed amount</Label>
                            <Input
                              type="number"
                              min={0}
                              step={0.01}
                              value={row.fixedAmount ?? ""}
                              onChange={(e) =>
                                updateAttrRow(index, {
                                  fixedAmount: e.target.value === "" ? null : parseFloat(e.target.value) || 0,
                                })
                              }
                            />
                          </div>
                          <div className="flex items-end">
                            <Button type="button" variant="outline" size="sm" onClick={() => removeAttrRow(index)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={addAttrRow}>
                        Add row
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <Label htmlFor="subtotal">Subtotal (Original Amount) *</Label>
              <Input
                id="subtotal"
                type="number"
                step="0.01"
                min="0"
                value={formData.subtotal}
                onChange={(e) => setFormData({ ...formData, subtotal: e.target.value })}
                required
              />
              <p className="text-xs text-gray-500">Total amount before discount and tax</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description of Services/Products</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={4}
                placeholder="Describe the services or products being invoiced..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentDetailsId">Payment Details</Label>
              <Select
                id="paymentDetailsId"
                value={formData.paymentDetailsId}
                onChange={(e) => setFormData({ ...formData, paymentDetailsId: e.target.value })}
              >
                <option value="">No payment details</option>
                {paymentDetails.map((pd) => (
                  <option key={pd.id} value={pd.id}>
                    {pd.name} {pd.isDefault ? "(Default)" : ""}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-gray-500">Select payment details to display at the bottom of the invoice PDF</p>
            </div>

            <div className="space-y-4 border-t pt-4">
              <h3 className="font-semibold">Discount</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="discountPercent">Discount Percentage (%)</Label>
                  <Input
                    id="discountPercent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.discountPercent}
                    onChange={(e) => {
                      setFormData({ ...formData, discountPercent: e.target.value, discountAmount: "" })
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discountAmount">Discount Amount</Label>
                  <Input
                    id="discountAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.discountAmount}
                    onChange={(e) => {
                      setFormData({ ...formData, discountAmount: e.target.value, discountPercent: "" })
                    }}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">Enter either percentage or amount (not both)</p>
            </div>

            <div className="space-y-4 border-t pt-4">
              <h3 className="font-semibold">Tax</h3>
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="taxInclusive"
                    checked={formData.taxInclusive}
                    onCheckedChange={(checked) => setFormData({ ...formData, taxInclusive: !!checked })}
                  />
                  <Label htmlFor="taxInclusive" className="cursor-pointer">
                    Tax is included in the amount
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="taxRate">Tax Rate (%)</Label>
                  <Select
                    id="taxRate"
                    value={formData.taxRate}
                    onChange={(e) => setFormData({ ...formData, taxRate: e.target.value })}
                  >
                    <option value="0">0%</option>
                    <option value="16">16%</option>
                    <option value="22">22%</option>
                    <option value="23">23%</option>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label>Calculated Total Amount</Label>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                <p className="text-lg font-semibold text-blue-800">
                  {formatCurrency(calculatedAmount)}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date</Label>
              <Input
                id="dueDate"
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
              />
            </div>

            {error && (
              <div className="text-sm text-destructive">{error}</div>
            )}

            <div className="flex space-x-4">
              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create Invoice"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
