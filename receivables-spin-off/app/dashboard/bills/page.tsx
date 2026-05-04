import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Plus, Search, Upload } from "lucide-react"
import { Input } from "@/components/ui/input"
import { BillStatus } from "@prisma/client"
import { InvoiceStatusFilter } from "@/components/invoices/InvoiceStatusFilter"
import { InvoiceClientFilter } from "@/components/invoices/InvoiceClientFilter"
import { InvoicesList } from "@/components/invoices/InvoicesList"

export const dynamic = 'force-dynamic'

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; clientId?: string; page?: string; limit?: string }>
}) {
  try {
    const session = await getServerSession(authOptions)
    const params = await searchParams
    const statusParam = params?.status
    const clientIdParam = params?.clientId
    const page = parseInt(params?.page || "1")
    const limit = parseInt(params?.limit || "50")
    const skip = (page - 1) * limit

    if (!session || !session.user) {
      return <div>Please log in to view invoices.</div>
    }

    // Build where clause
    const where: any = {
      deletedAt: null, // Exclude deleted items
    }
    
    // Handle status filter (support comma-separated values and "outstanding")
    if (statusParam) {
      if (statusParam === "OUTSTANDING") {
        // Outstanding: status != PAID && dueDate < now
        where.status = { not: "PAID" }
        where.dueDate = { lt: new Date() }
      } else {
        const statuses = statusParam.split(",").map(s => s.trim())
        if (statuses.length === 1) {
          where.status = statuses[0]
        } else {
          where.status = { in: statuses }
        }
      }
    }

    // Filter by client
    if (clientIdParam) {
      where.clientId = clientIdParam
    }

    // Filter for clients
    if (session.user.role === "CLIENT") {
      const client = await prisma.client.findFirst({
        where: { email: session.user.email },
      })
      if (client) {
        where.clientId = client.id
      } else {
        return (
          <div>
            <h1 className="text-3xl font-bold">Invoices</h1>
            <p className="text-gray-600 mt-2">No invoices found.</p>
          </div>
        )
      }
    }

    // Filter for EXTERNAL users - only show invoices for clients where they are manager or finder
    if (session.user.role === "EXTERNAL") {
      const clients = await prisma.client.findMany({
        where: {
          OR: [
            { clientManagerId: session.user.id },
            { finders: { some: { userId: session.user.id } } },
          ],
          deletedAt: null,
        },
        select: { id: true },
      })
      const clientIds = clients.map(c => c.id)
      if (clientIds.length === 0) {
        return (
          <div>
            <h1 className="text-3xl font-bold">Invoices</h1>
            <p className="text-gray-600 mt-2">No invoices found.</p>
          </div>
        )
      }
      where.clientId = { in: clientIds }
    }

    const [bills, total] = await Promise.all([
      prisma.bill.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          client: {
            select: {
              id: true,
              name: true,
              company: true,
            },
          },
          proposal: {
            select: {
              title: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.bill.count({ where })
    ])

    // Fetch clients for filter dropdowns (only for non-client users)
    const clients = session.user.role !== "CLIENT" 
      ? await prisma.client.findMany({
          where: {
            deletedAt: null, // Exclude deleted clients
          },
          select: { id: true, name: true, company: true },
          orderBy: { name: "asc" },
        })
      : []

    const filteredBills = bills

    const getStatusColor = (status: BillStatus) => {
      switch (status) {
        case "DRAFT":
          return "bg-gray-100 text-gray-800"
        case "SUBMITTED":
          return "bg-blue-100 text-blue-800"
        case "APPROVED":
          return "bg-green-100 text-green-800"
        case "PAID":
          return "bg-emerald-100 text-emerald-800"
        case "CANCELLED":
          return "bg-red-100 text-red-800"
        case "WRITTEN_OFF":
          return "bg-orange-100 text-orange-800"
        default:
          return "bg-gray-100 text-gray-800"
      }
    }

    return (
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Invoices</h1>
            <p className="text-gray-600 mt-2">Manage your invoices</p>
          </div>
          {session.user.role !== "CLIENT" && (
            <div className="flex items-center gap-2">
              <Link href="/dashboard/bills/import">
                <Button variant="outline">
                  <Upload className="h-4 w-4 mr-2" />
                  Import CSV
                </Button>
              </Link>
              <Link href="/dashboard/bills/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  New Invoice
                </Button>
              </Link>
            </div>
          )}
        </div>

        <div className="mb-4 space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search invoices..."
                className="pl-10"
              />
            </div>
            <InvoiceStatusFilter />
            {session.user.role !== "CLIENT" && clients.length > 0 && (
              <InvoiceClientFilter clients={clients} />
            )}
          </div>
          {(statusParam || clientIdParam) && (
            <div className="text-sm text-gray-600">
              Filters:{" "}
              {statusParam && (
                <span>Status: {statusParam === "OUTSTANDING" ? "Outstanding" : statusParam.split(",").join(", ")}</span>
              )}
              {clientIdParam && (
                <span>
                  {statusParam && " • "}
                  Client: {clients.find(c => c.id === clientIdParam)?.name || clientIdParam}
                </span>
              )}
            </div>
          )}
        </div>

        <InvoicesList
          bills={filteredBills}
          isAdmin={session.user.role === "ADMIN" || session.user.role === "MANAGER"}
        />

        {filteredBills.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500 mb-4">No invoices yet</p>
              {session.user.role !== "CLIENT" && (
                <Link href="/dashboard/bills/new">
                  <Button>Create Your First Invoice</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    )
  } catch (error) {
    console.error("Error loading invoices:", error)
  return (
    <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Error Loading Invoices</h1>
        <p className="text-red-600">{(error as Error).message}</p>
        <p className="text-sm text-gray-500 mt-2">Check the terminal for more details.</p>
    </div>
  )
  }
}
