"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Plus, Edit, Trash2, Calendar, DollarSign } from "lucide-react"

interface Advance {
  id: string
  type: "RECURRING" | "ONE_OFF"
  description: string
  amount: number
  currency: string
  startDate: string
  endDate: string | null
  frequency: "MONTHLY" | "QUARTERLY" | "YEARLY" | null
  isActive: boolean
  createdAt: string
  creator: {
    id: string
    name: string
    email: string
  }
  transactions: Array<{
    id: string
    amount: number
    transactionDate: string
    description: string
  }>
}

interface AdvancesSectionProps {
  userId: string
  startDate: string | null
  endDate: string | null
  isAdmin: boolean
}

export function AdvancesSection({ userId, startDate, endDate, isAdmin }: AdvancesSectionProps) {
  const [advances, setAdvances] = useState<Advance[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingAdvance, setEditingAdvance] = useState<Advance | null>(null)
  const [formData, setFormData] = useState({
    type: "ONE_OFF" as "RECURRING" | "ONE_OFF",
    description: "",
    amount: "",
    currency: "EUR",
    startDate: new Date().toISOString().split("T")[0],
    endDate: "",
    frequency: "MONTHLY" as "MONTHLY" | "QUARTERLY" | "YEARLY" | null,
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchAdvances()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, startDate, endDate])

  const fetchAdvances = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (startDate || endDate) {
        // Filtering handled server-side
      }
      const response = await fetch(`/api/users/${userId}/advances?${params.toString()}`)
      const data = await response.json()
      setAdvances(data.advances || [])
    } catch (error) {
      console.error("Error fetching advances:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingAdvance(null)
    setFormData({
      type: "ONE_OFF",
      description: "",
      amount: "",
      currency: "EUR",
      startDate: new Date().toISOString().split("T")[0],
      endDate: "",
      frequency: "MONTHLY",
    })
    setShowCreateModal(true)
  }

  const handleEdit = (advance: Advance) => {
    setEditingAdvance(advance)
    setFormData({
      type: advance.type,
      description: advance.description,
      amount: advance.amount.toString(),
      currency: advance.currency,
      startDate: new Date(advance.startDate).toISOString().split("T")[0],
      endDate: advance.endDate ? new Date(advance.endDate).toISOString().split("T")[0] : "",
      frequency: advance.frequency || "MONTHLY",
    })
    setShowCreateModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const url = editingAdvance
        ? `/api/users/${userId}/advances/${editingAdvance.id}`
        : `/api/users/${userId}/advances`
      const method = editingAdvance ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          amount: parseFloat(formData.amount),
          endDate: formData.endDate || null,
          frequency: formData.type === "RECURRING" ? formData.frequency : null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || "Failed to save advance")
        return
      }

      setShowCreateModal(false)
      await fetchAdvances()
    } catch (error) {
      console.error("Error saving advance:", error)
      alert("Failed to save advance")
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (advanceId: string) => {
    if (!confirm("Delete this advance line and all related advance transactions? This cannot be undone.")) return

    try {
      const response = await fetch(`/api/users/${userId}/advances/${advanceId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const error = await response.json()
        alert(error.error || "Failed to delete advance")
        return
      }

      await fetchAdvances()
    } catch (error) {
      console.error("Error deleting advance:", error)
      alert("Failed to delete advance")
    }
  }

  const calculateCreditBalance = (advance: Advance): number => {
    return advance.transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0)
  }

  if (loading) {
    return <div>Loading advances...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Office Advances</h3>
          <p className="text-sm text-gray-600">Advances paid by the office (tracked as credits)</p>
        </div>
        {isAdmin && (
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Create Advance
          </Button>
        )}
      </div>

      {advances.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-gray-500">No advances found for the selected period.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {advances.map((advance) => {
            const creditBalance = calculateCreditBalance(advance)
            return (
              <Card key={advance.id} className={!advance.isActive ? "opacity-60" : ""}>
                <CardContent className="pt-6">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 mb-2">
                        <h4 className="font-semibold">{advance.description}</h4>
                        <span className={`px-2 py-1 rounded text-xs ${
                          advance.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                        }`}>
                          {advance.isActive ? "Active" : "Inactive"}
                        </span>
                        <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800">
                          {advance.type === "RECURRING" ? "Recurring" : "One-off"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-600">Amount:</span>
                          <div className="font-semibold">{formatCurrency(advance.amount)}</div>
                        </div>
                        <div>
                          <span className="text-gray-600">Credit Balance:</span>
                          <div className="font-semibold text-red-600">{formatCurrency(creditBalance)}</div>
                        </div>
                        <div>
                          <span className="text-gray-600">Start Date:</span>
                          <div className="font-semibold">{formatDate(advance.startDate)}</div>
                        </div>
                        {advance.endDate && (
                          <div>
                            <span className="text-gray-600">End Date:</span>
                            <div className="font-semibold">{formatDate(advance.endDate)}</div>
                          </div>
                        )}
                        {advance.frequency && (
                          <div>
                            <span className="text-gray-600">Frequency:</span>
                            <div className="font-semibold">{advance.frequency}</div>
                          </div>
                        )}
                      </div>
                      {advance.transactions.length > 0 && (
                        <div className="mt-4 pt-4 border-t">
                          <div className="text-sm font-medium mb-2">Transaction History:</div>
                          <div className="space-y-1">
                            {advance.transactions.map((transaction) => (
                              <div key={transaction.id} className="flex justify-between text-sm">
                                <span>{formatDate(transaction.transactionDate)}</span>
                                <span className="font-semibold">{formatCurrency(Math.abs(transaction.amount))}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(advance)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(advance.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-2xl m-4 max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>{editingAdvance ? "Edit Advance" : "Create Advance"}</CardTitle>
              <CardDescription>
                {editingAdvance ? "Update advance details" : "Create a new office advance"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Type *</Label>
                  <Select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as "RECURRING" | "ONE_OFF" })}
                  >
                    <option value="ONE_OFF">One-off</option>
                    <option value="RECURRING">Recurring</option>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Description *</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    required
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Amount *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Select
                      value={formData.currency}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    >
                      <option value="EUR">EUR</option>
                      <option value="USD">USD</option>
                      <option value="GBP">GBP</option>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Start Date *</Label>
                  <Input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    required
                  />
                </div>

                {formData.type === "RECURRING" && (
                  <>
                    <div className="space-y-2">
                      <Label>End Date *</Label>
                      <Input
                        type="date"
                        value={formData.endDate}
                        onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Frequency *</Label>
                      <Select
                        value={formData.frequency || "MONTHLY"}
                        onChange={(e) => setFormData({ ...formData, frequency: e.target.value as "MONTHLY" | "QUARTERLY" | "YEARLY" })}
                      >
                        <option value="MONTHLY">Monthly</option>
                        <option value="QUARTERLY">Quarterly</option>
                        <option value="YEARLY">Yearly</option>
                      </Select>
                    </div>
                  </>
                )}

                <div className="flex justify-end gap-4 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCreateModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Saving..." : editingAdvance ? "Update" : "Create"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
