"use client"

import { useState } from "react"
import Link from "next/link"
import Papa from "papaparse"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"

const FIELD_TAGS: Array<{ value: string; label: string; group: string }> = [
  { value: "clientName", label: "Client Name", group: "Clients tab" },
  { value: "clientEmail", label: "Client Email", group: "Clients tab" },
  { value: "clientCompany", label: "Client Company", group: "Clients tab" },
  { value: "leadName", label: "Lead Name", group: "Leads tab" },
  { value: "leadCompany", label: "Lead Company", group: "Leads tab" },
  { value: "sectorName", label: "Sector of Activity", group: "Leads tab" },
  { value: "areaOfLawName", label: "Area of Law", group: "Leads tab" },
  { value: "invoiceNumber", label: "Invoice Number", group: "Invoices tab" },
  { value: "description", label: "Description / Inventory", group: "Invoices tab" },
  { value: "tranType", label: "Transaction Type", group: "Invoices tab" },
  { value: "issueDate", label: "Issue Date", group: "Invoices tab" },
  { value: "dueDate", label: "Due Date", group: "Invoices tab" },
  { value: "paymentStatus", label: "Payment Status", group: "Invoices tab" },
  { value: "paidDate", label: "Paid Date", group: "Invoices tab" },
  { value: "currency", label: "Currency", group: "Invoices tab" },
  { value: "quantity", label: "Quantity", group: "Invoices tab" },
  { value: "unitPrice", label: "Unit Price", group: "Invoices tab" },
  { value: "subtotal", label: "Subtotal (Amount before Tax)", group: "Invoices tab" },
  { value: "taxAmount", label: "Tax Amount", group: "Invoices tab" },
  { value: "taxRate", label: "Tax Rate", group: "Invoices tab" },
  { value: "discountPercent", label: "Discount Percent", group: "Invoices tab" },
  { value: "totalAmount", label: "Total Amount", group: "Invoices tab" },
  { value: "finderUser", label: "Finder User (future rule input)", group: "Fees tab" },
  { value: "managerUser", label: "Client Manager User (future rule input)", group: "Fees tab" },
]

function inferTag(header: string): string {
  const h = header.trim().toLowerCase()
  if (h === "customer" || h.includes("client")) return "clientName"
  if (h.includes("email")) return "clientEmail"
  if (h.includes("company")) return "clientCompany"
  if (h.includes("lead")) return "leadName"
  if (h.includes("tran number") || h.includes("invoice number")) return "invoiceNumber"
  if (h.includes("tran type")) return "tranType"
  if (h.includes("inventory name") || h.includes("description")) return "description"
  if (h.includes("issue date")) return "issueDate"
  if (h.includes("due date")) return "dueDate"
  if (h.includes("paid date") || h.includes("payment date")) return "paidDate"
  if (h.includes("payment status") || h === "status" || h.includes("is paid")) return "paymentStatus"
  if (h.includes("currency") || h.includes("moeda")) return "currency"
  if (h.includes("amount before tax")) return "subtotal"
  if (h.includes("total amount")) return "totalAmount"
  if (h.includes("tax amount")) return "taxAmount"
  if (h.includes("tax rate")) return "taxRate"
  if (h.includes("discount")) return "discountPercent"
  if (h.includes("quantity")) return "quantity"
  if (h.includes("unit price")) return "unitPrice"
  if (h.includes("sector")) return "sectorName"
  if (h.includes("area of law") || h === "area") return "areaOfLawName"
  return ""
}

export default function InvoiceImportPage() {
  const router = useRouter()
  const [fileName, setFileName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [previewRows, setPreviewRows] = useState<any[]>([])
  const [parsedRows, setParsedRows] = useState<any[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [columnToTag, setColumnToTag] = useState<Record<string, string>>({})

  const parseFile = async (file: File): Promise<any[]> => {
    const lower = file.name.toLowerCase()
    if (lower.endsWith(".csv")) {
      return await new Promise<any[]>((resolve, reject) => {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data as any[]),
          error: () => reject(new Error("Could not parse CSV file")),
        })
      })
    }

    if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
      const formData = new FormData()
      formData.append("file", file)
      const response = await fetch("/api/invoice-imports/parse-file", {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        throw new Error(err?.error || "Could not parse XLS file")
      }
      const payload = await response.json()
      return (payload.rows || []) as any[]
    }

    throw new Error("Unsupported file format. Use CSV, XLS, or XLSX.")
  }

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError("")

    parseFile(file)
      .then((rows) => {
        setParsedRows(rows)
        setPreviewRows(rows.slice(0, 10))
        const discoveredHeaders = rows.length > 0 ? Object.keys(rows[0] ?? {}) : []
        setHeaders(discoveredHeaders)
        const inferred: Record<string, string> = {}
        discoveredHeaders.forEach((header) => {
          const tag = inferTag(header)
          if (tag) inferred[header] = tag
        })
        setColumnToTag(inferred)
      })
      .catch((err: Error) => setError(err.message))
  }

  const remapRowsToTags = (rows: any[]): any[] => {
    if (rows.length === 0) return rows
    return rows.map((row) => {
      const mapped: Record<string, any> = {}
      Object.entries(columnToTag).forEach(([column, tag]) => {
        if (!tag) return
        mapped[tag] = row[column]
      })
      mapped.__originalRow = row
      return mapped
    })
  }

  const stageImport = async () => {
    const fileInput = document.getElementById("csvFile") as HTMLInputElement | null
    const file = fileInput?.files?.[0]
    if (!file) return

    setLoading(true)
    setError("")

    try {
      const rows = parsedRows.length > 0 ? parsedRows : await parseFile(file)
      const mappedRows = remapRowsToTags(rows)
      const response = await fetch("/api/invoice-imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          rows: mappedRows,
        }),
      })

      if (!response.ok) {
        setError("Failed to stage import")
        setLoading(false)
        return
      }

      const batch = await response.json()
      router.push(`/dashboard/bills/import/${batch.id}`)
    } catch (err: any) {
      setError(err?.message || "Could not parse file")
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Import Invoices from CSV/XLS</h1>
        <Link href="/dashboard/bills">
          <Button variant="outline">Back to Invoices</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload file</CardTitle>
          <CardDescription>
            Upload receivables/invoice rows from CSV, XLS, or XLSX. Data is staged for review before invoice creation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input id="csvFile" type="file" accept=".csv,.xls,.xlsx" onChange={onFileChange} />
          {fileName && <p className="text-sm text-muted-foreground">Selected file: {fileName}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={stageImport} disabled={!fileName || loading}>
            {loading ? "Staging..." : "Stage Import"}
          </Button>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Map File Columns to Billlex Tags</CardTitle>
            <CardDescription>
              Tag each column to match existing Billlex tabs and fields before import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {headers.map((header) => (
              <div key={header} className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                <Label className="text-sm font-medium">{header}</Label>
                <Select
                  value={columnToTag[header] || ""}
                  onChange={(e) => {
                    const nextTag = e.target.value
                    setColumnToTag((prev) => {
                      const updated: Record<string, string> = { ...prev }
                      // Keep mapping unique per tag.
                      Object.keys(updated).forEach((key) => {
                        if (updated[key] === nextTag) updated[key] = ""
                      })
                      updated[header] = nextTag
                      return updated
                    })
                  }}
                >
                  <option value="">Ignore this column</option>
                  {FIELD_TAGS.map((tag) => (
                    <option key={tag.value} value={tag.value}>
                      {tag.group} - {tag.label}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {previewRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview (first 10 rows)</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded">
              {JSON.stringify(previewRows, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

