type RequestMethod = "GET" | "POST"

export type AvazaParty = {
  id: string
  name?: string
  email?: string
  company_name?: string
  updated_at?: string
}

export type AvazaInvoice = {
  id: string
  invoice_number?: string
  party_id?: string
  status?: string
  amount?: number | string
  total?: number | string
  issue_date?: string
  due_date?: string
  paid_date?: string
  paid_at?: string
  updated_at?: string
}

type AvazaCompanyApi = {
  CompanyID?: number | string
  CompanyName?: string
  DateUpdated?: string
  Contacts?: Array<{ Email?: string }>
}

type AvazaInvoiceApi = {
  TransactionID?: number | string
  InvoiceNumber?: string
  CompanyIDFK?: number | string
  TransactionStatusCode?: string
  TotalAmount?: number | string
  DateIssued?: string
  DueDate?: string
  DateUpdated?: string
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function resolveBaseUrl(): string {
  const raw = process.env.AVAZA_API_BASE_URL?.trim()
  if (raw) return raw
  return "https://api.avaza.com"
}

async function requestWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await fetch(url, init)
      if (res.status >= 500 && i < retries) {
        await new Promise((r) => setTimeout(r, (i + 1) * 500))
        continue
      }
      return res
    } catch (err) {
      lastErr = err
      if (i < retries) {
        await new Promise((r) => setTimeout(r, (i + 1) * 500))
        continue
      }
    }
  }
  throw lastErr ?? new Error("Avaza request failed")
}

export class AvazaClient {
  private readonly baseUrl: string
  private readonly token: string

  constructor() {
    this.baseUrl = resolveBaseUrl()
    this.token = requireEnv("AVAZA_API_TOKEN")
  }

  private async request<T>(path: string, method: RequestMethod = "GET"): Promise<T> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${path}`
    const res = await requestWithRetry(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Avaza ${method} ${path} failed: ${res.status} ${text}`)
    }
    return (await res.json()) as T
  }

  async getAccountSummary(): Promise<{ accountId?: number | string; companyName?: string; subdomain?: string }> {
    const payload = await this.request<any>("/api/Account")
    return {
      accountId: payload?.AccountID,
      companyName: payload?.CompanyName,
      subdomain: payload?.Subdomain,
    }
  }

  async getConnectionProbe(): Promise<{ companyCount: number; invoiceCount: number }> {
    const [companiesPayload, invoicesPayload] = await Promise.all([
      this.request<any>("/api/Company?PageNumber=1&PageSize=1"),
      this.request<any>("/api/Invoice?PageNumber=1&PageSize=1"),
    ])
    return {
      companyCount: Number(companiesPayload?.TotalCount ?? 0) || 0,
      invoiceCount: Number(invoicesPayload?.TotalCount ?? 0) || 0,
    }
  }

  private async fetchPagedList<TItem>(
    endpoint: string,
    arrayKey: string,
    buildQuery: (pageNumber: number) => URLSearchParams
  ): Promise<TItem[]> {
    const all: TItem[] = []
    let page = 1
    let totalCount = 0
    let pageSize = 20

    do {
      const q = buildQuery(page)
      const payload = await this.request<any>(`${endpoint}?${q.toString()}`)
      const items = Array.isArray(payload?.[arrayKey]) ? (payload[arrayKey] as TItem[]) : []
      all.push(...items)
      totalCount = Number(payload?.TotalCount ?? all.length) || all.length
      pageSize = Number((payload?.PageSize ?? items.length) || pageSize) || pageSize
      page += 1
      if (items.length === 0) break
    } while (all.length < totalCount)

    return all
  }

  async listClients(updatedSince?: Date): Promise<AvazaParty[]> {
    const companies = await this.fetchPagedList<AvazaCompanyApi>("/api/Company", "Companies", (pageNumber) => {
      const q = new URLSearchParams()
      q.set("PageNumber", String(pageNumber))
      q.set("PageSize", "100")
      if (updatedSince) q.set("UpdatedSince", updatedSince.toISOString())
      return q
    })

    return companies
      .filter((c) => c.CompanyID !== undefined && c.CompanyID !== null)
      .map((c) => {
        const email = c.Contacts?.find((x) => typeof x?.Email === "string" && x.Email.trim())?.Email?.trim()
        return {
          id: String(c.CompanyID),
          name: c.CompanyName?.trim() || `Avaza Client ${c.CompanyID}`,
          email: email || undefined,
          company_name: c.CompanyName?.trim() || undefined,
          updated_at: c.DateUpdated,
        } satisfies AvazaParty
      })
  }

  async listInvoices(updatedSince?: Date): Promise<AvazaInvoice[]> {
    const invoices = await this.fetchPagedList<AvazaInvoiceApi>("/api/Invoice", "Invoices", (pageNumber) => {
      const q = new URLSearchParams()
      q.set("PageNumber", String(pageNumber))
      q.set("PageSize", "100")
      if (updatedSince) q.set("UpdatedSince", updatedSince.toISOString())
      return q
    })

    return invoices
      .filter((i) => i.TransactionID !== undefined && i.TransactionID !== null)
      .map((i) => ({
        id: String(i.TransactionID),
        invoice_number: i.InvoiceNumber || undefined,
        party_id: i.CompanyIDFK !== undefined && i.CompanyIDFK !== null ? String(i.CompanyIDFK) : undefined,
        status: i.TransactionStatusCode || undefined,
        total: i.TotalAmount,
        issue_date: i.DateIssued,
        due_date: i.DueDate,
        updated_at: i.DateUpdated,
      }))
  }

  async listInvoicesPage(
    updatedSince: Date | undefined,
    pageNumber: number,
    pageSize = 100
  ): Promise<{ invoices: AvazaInvoice[]; totalCount: number; pageSize: number; pageNumber: number }> {
    const q = new URLSearchParams()
    q.set("PageNumber", String(pageNumber))
    q.set("PageSize", String(pageSize))
    if (updatedSince) q.set("UpdatedSince", updatedSince.toISOString())
    const payload = await this.request<any>(`/api/Invoice?${q.toString()}`)
    const rows = Array.isArray(payload?.Invoices) ? (payload.Invoices as AvazaInvoiceApi[]) : []
    const invoices = rows
      .filter((i) => i.TransactionID !== undefined && i.TransactionID !== null)
      .map((i) => ({
        id: String(i.TransactionID),
        invoice_number: i.InvoiceNumber || undefined,
        party_id: i.CompanyIDFK !== undefined && i.CompanyIDFK !== null ? String(i.CompanyIDFK) : undefined,
        status: i.TransactionStatusCode || undefined,
        total: i.TotalAmount,
        issue_date: i.DateIssued,
        due_date: i.DueDate,
        updated_at: i.DateUpdated,
      }))
    return {
      invoices,
      totalCount: Number(payload?.TotalCount ?? invoices.length) || invoices.length,
      pageSize: Number(payload?.PageSize ?? pageSize) || pageSize,
      pageNumber,
    }
  }
}

