export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import * as XLSX from "xlsx"

const KNOWN_HEADERS = [
  "customer",
  "issue date",
  "due date",
  "payment date",
  "status",
  "currency",
  "tran number",
  "quantity",
  "unit price",
  "amount before tax",
  "tax amount",
  "total amount",
]

function normalizeCell(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
}

function findHeaderRowIndex(rows: unknown[][]): number {
  const maxScan = Math.min(rows.length, 30)
  let bestIndex = 0
  let bestScore = -1

  for (let i = 0; i < maxScan; i += 1) {
    const row = rows[i] || []
    const normalized = row.map(normalizeCell)
    const score = KNOWN_HEADERS.reduce(
      (acc, header) => (normalized.includes(header) ? acc + 1 : acc),
      0
    )
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return bestIndex
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role === "CLIENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required" }, { status: 400 })
  }

  const lower = file.name.toLowerCase()
  if (!lower.endsWith(".xls") && !lower.endsWith(".xlsx")) {
    return NextResponse.json({ error: "Only XLS/XLSX are supported here" }, { status: 400 })
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]]

    // Read as matrix first so we can detect files where headers start later
    // (e.g., row 7 instead of row 1).
    const matrix = XLSX.utils.sheet_to_json(firstSheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][]

    const headerRowIndex = findHeaderRowIndex(matrix)
    const headers = (matrix[headerRowIndex] || []).map((h) => String(h).trim())
    const dataRows = matrix.slice(headerRowIndex + 1)

    const rows = dataRows
      .map((dataRow) => {
        const entry: Record<string, unknown> = {}
        headers.forEach((header, colIndex) => {
          if (!header) return
          entry[header] = dataRow[colIndex] ?? ""
        })

        // Keep positional fallbacks for spreadsheets where key fields are set by column
        // placement (e.g. merged client name in B:C and invoice number in F).
        const colB = String(dataRow[1] ?? "").trim()
        const colC = String(dataRow[2] ?? "").trim()
        const mergedClient = [colB, colC].filter(Boolean).join(" ").trim()
        if (mergedClient) entry.__mergedClientBC = mergedClient
        entry.__colF = String(dataRow[5] ?? "").trim()

        return entry
      })
      .filter((row) =>
        Object.values(row).some((value) => String(value ?? "").trim().length > 0)
      )

    return NextResponse.json({ rows })
  } catch {
    return NextResponse.json({ error: "Could not parse XLS file" }, { status: 400 })
  }
}

