"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ImportRow = {
  id: string
  rowIndex: number
  status: "VALID" | "INVALID" | "IMPORTED"
  errorMessage?: string | null
  clientName?: string | null
  clientEmail?: string | null
  clientCompany?: string | null
  leadName?: string | null
  invoiceNumber?: string | null
  dueDate?: string | null
  taxRate?: number | null
  discountPercent?: number | null
  description?: string | null
  subtotal?: number | null
  rawData?: Record<string, unknown> | null
}

const DETAIL_FIELDS: Array<{ key: string; label: string }> = [
  { key: "clientName", label: "Client Name" },
  { key: "clientEmail", label: "Client Email" },
  { key: "clientCompany", label: "Client Company" },
  { key: "leadName", label: "Lead Name" },
  { key: "invoiceNumber", label: "Invoice Number" },
  { key: "description", label: "Description" },
  { key: "dueDate", label: "Due Date" },
  { key: "subtotal", label: "Subtotal" },
  { key: "taxRate", label: "Tax Rate" },
  { key: "discountPercent", label: "Discount %" },
  { key: "totalAmount", label: "Total Amount" },
  { key: "issueDate", label: "Issue Date" },
  { key: "quantity", label: "Quantity" },
  { key: "unitPrice", label: "Unit Price" },
  { key: "taxAmount", label: "Tax Amount" },
  { key: "tranType", label: "Tran Type" },
  { key: "inventoryName", label: "Inventory Name" },
]

export default function InvoiceImportReviewPage() {
  const params = useParams()
  const router = useRouter()
  const batchId = params.id as string
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [batch, setBatch] = useState<any>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [rowFieldSelection, setRowFieldSelection] = useState<Record<string, string[]>>({})

  const loadBatch = async () => {
    setLoading(true)
    const response = await fetch(`/api/invoice-imports/${batchId}`)
    const data = await response.json()
    setBatch(data)

    const rows: ImportRow[] = data?.rows || []
    const valid = rows.filter((r) => r.status === "VALID")
    setSelectedRowIds(new Set(valid.map((r) => r.id)))
    const defaults: Record<string, string[]> = {}
    valid.forEach((r) => {
      defaults[r.id] = [
        "clientName",
        "invoiceNumber",
        "description",
        "subtotal",
        "totalAmount",
      ]
    })
    setRowFieldSelection(defaults)
    setLoading(false)
  }

  useEffect(() => {
    if (batchId) loadBatch()
  }, [batchId])

  const confirmImport = async () => {
    setConfirming(true)
    const response = await fetch(`/api/invoice-imports/${batchId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selectedRowIds: Array.from(selectedRowIds),
        rowFieldSelection,
      }),
    })
    setConfirming(false)
    if (!response.ok) return
    router.push("/dashboard/bills")
  }

  if (loading) return <div>Loading...</div>
  if (!batch) return <div>Import batch not found.</div>

  const rows: ImportRow[] = batch.rows || []
  const validRows = rows.filter((r) => r.status === "VALID")
  const invalidRows = rows.filter((r) => r.status === "INVALID")
  const selectedValidCount = validRows.filter((r) => selectedRowIds.has(r.id)).length

  const getDisplayValue = (row: ImportRow, key: string): string => {
    const raw = (row.rawData || {}) as Record<string, unknown>
    switch (key) {
      case "totalAmount":
        return String(raw.__resolvedTotalAmount ?? raw.totalAmount ?? raw["Total Amount"] ?? raw.total ?? "")
      case "issueDate":
        return String(raw["Issue Date"] ?? raw.issueDate ?? "")
      case "quantity":
        return String(raw.quantity ?? raw.Quantity ?? "")
      case "unitPrice":
        return String(raw.unitPrice ?? raw["Unit Price"] ?? "")
      case "taxAmount":
        return String(raw.taxAmount ?? raw["Tax Amount"] ?? "")
      case "tranType":
        return String(raw.tranType ?? raw["Tran Type"] ?? "")
      case "inventoryName":
        return String(raw["Inventory Name"] ?? raw.inventoryName ?? "")
      default:
        return String((row as any)[key] ?? "")
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Review Import Batch</h1>
        <Link href="/dashboard/bills/import">
          <Button variant="outline">New Import</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{batch.fileName}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <div>Total rows: {batch.totalRows}</div>
          <div>Valid rows: {batch.validRows}</div>
          <div>Invalid rows: {batch.invalidRows}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invalid Rows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {invalidRows.length === 0 && <p className="text-sm text-muted-foreground">No invalid rows.</p>}
          {invalidRows.map((row) => (
            <div key={row.id} className="p-2 rounded border text-sm">
              Row {row.rowIndex}: {row.errorMessage || "Invalid data"}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Valid Rows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedRowIds(new Set(validRows.map((r) => r.id)))}
            >
              Select all valid
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedRowIds(new Set())}
            >
              Clear selection
            </Button>
            <span className="text-sm text-muted-foreground">
              {selectedValidCount} of {validRows.length} valid rows selected
            </span>
          </div>

          {validRows.slice(0, 200).map((row) => (
            <div key={row.id} className="p-3 rounded border text-sm space-y-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedRowIds.has(row.id)}
                  onChange={(e) => {
                    setSelectedRowIds((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(row.id)
                      else next.delete(row.id)
                      return next
                    })
                  }}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">
                    Row {row.rowIndex} - {(row.clientName || row.leadName || "N/A")}
                  </div>
                  <div className="text-muted-foreground">
                    Invoice: {row.invoiceNumber || "auto"} | Subtotal: {row.subtotal ?? 0}
                  </div>
                </div>
              </div>

              <div className="pl-7">
                <div className="text-xs font-medium mb-2">Summary fields included in invoice description</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {DETAIL_FIELDS.map((field) => {
                    const selected = (rowFieldSelection[row.id] || []).includes(field.key)
                    const value = getDisplayValue(row, field.key)
                    const hasValue = value !== "" && value !== "null" && value !== "undefined"
                    return (
                      <label key={`${row.id}-${field.key}`} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!hasValue}
                          onChange={(e) => {
                            setRowFieldSelection((prev) => {
                              const current = new Set(prev[row.id] || [])
                              if (e.target.checked) current.add(field.key)
                              else current.delete(field.key)
                              return { ...prev, [row.id]: Array.from(current) }
                            })
                          }}
                        />
                        <span>{field.label}</span>
                        {hasValue && <span className="text-muted-foreground truncate">({value})</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          onClick={confirmImport}
          disabled={confirming || selectedValidCount === 0 || batch.status === "CONFIRMED"}
        >
          {confirming ? "Importing..." : "Confirm & Create Invoices"}
        </Button>
        <Link href="/dashboard/bills">
          <Button variant="outline">Cancel</Button>
        </Link>
      </div>
    </div>
  )
}

