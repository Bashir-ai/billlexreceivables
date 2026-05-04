import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { notFound } from "next/navigation"
import { formatDate, formatCurrency } from "@/lib/utils"
import { KycAlert } from "@/components/clients/KycAlert"
import { DeleteButton } from "@/components/shared/DeleteButton"
import { ArchiveButton } from "@/components/clients/ArchiveButton"
import { UserRole } from "@prisma/client"
import { CompensationEligibilityManager } from "@/components/accounts/CompensationEligibilityManager"

export const dynamic = 'force-dynamic'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getServerSession(authOptions)

  if (session?.user.role === "CLIENT") {
    return <div>Access denied</div>
  }

  const client = await prisma.client.findUnique({
    where: { 
      id,
      deletedAt: null, // Exclude deleted clients
      // Note: We allow viewing archived clients on detail page
    },
    include: {
      creator: {
        select: {
          name: true,
          email: true,
        },
      },
      proposals: {
        where: {
          deletedAt: null, // Exclude soft-deleted proposals
        },
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              items: true,
            },
          },
        },
      },
      bills: {
        where: {
          deletedAt: null, // Exclude soft-deleted bills
        },
        orderBy: { createdAt: "desc" },
      },
      projects: {
        where: {
          deletedAt: null, // Exclude soft-deleted projects
        },
        orderBy: { createdAt: "desc" },
      },
      finders: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      managementSplits: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      clientManager: { select: { id: true, name: true, email: true } },
    },
  })

  if (!client) {
    notFound()
  }

  return (
    <div>
      <KycAlert kycCompleted={client.kycCompleted} />
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">{client.name}</h1>
          {client.company && (
            <p className="text-gray-600 mt-2">{client.company}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={`/dashboard/clients/${client.id}/edit`}>
            <Button variant="outline">Edit</Button>
          </Link>
          {(session?.user.role === UserRole.ADMIN || session?.user.role === UserRole.MANAGER) && (
            <ArchiveButton
              clientId={client.id}
              clientName={client.name}
              isArchived={!!client.archivedAt}
            />
          )}
          {session?.user.role === UserRole.ADMIN && (
            <DeleteButton
              itemId={client.id}
              itemType="client"
              itemName={client.name}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <span className="text-sm text-gray-600">Type: </span>
              <span>{client.isIndividual ? "Individual Client" : "Company"}</span>
            </div>
            {client.fullLegalName && (
              <div>
                <span className="text-sm text-gray-600">Full Legal Name: </span>
                <span>{client.fullLegalName}</span>
              </div>
            )}
            {client.email && (
              <div>
                <span className="text-sm text-gray-600">Email: </span>
                <span>{client.email}</span>
              </div>
            )}
            {client.contactInfo && (
              <div>
                <span className="text-sm text-gray-600">Contact: </span>
                <span>{client.contactInfo}</span>
              </div>
            )}
            {(client.billingAddressLine || client.billingCity || client.billingState || client.billingZipCode || client.billingCountry) && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm font-semibold text-gray-600 mb-2">Billing Address:</p>
                {client.billingAddressLine && <p className="text-sm">{client.billingAddressLine}</p>}
                <p className="text-sm">
                  {[client.billingCity, client.billingState, client.billingZipCode].filter(Boolean).join(", ")}
                </p>
                {client.billingCountry && (
                  <p className="text-sm">{client.billingCountry}</p>
                )}
              </div>
            )}
            {client.finders && client.finders.length > 0 && (
              <div>
                <span className="text-sm text-gray-600">Client Finders: </span>
                <div className="mt-1 space-y-1">
                  {client.finders.map((finder) => (
                    <div key={finder.id} className="text-sm">
                      <span>{finder.user.name} ({finder.user.email})</span>
                      <span className="text-gray-500 ml-2">- {finder.finderFeePercent}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {client.clientManager && (
              <div>
                <span className="text-sm text-gray-600">Client Manager: </span>
                <span>{client.clientManager.name} ({client.clientManager.email})</span>
              </div>
            )}
            {client.managementSplits.length > 0 && (
              <div>
                <span className="text-sm text-gray-600">Management Splits: </span>
                <div className="mt-1 space-y-1">
                  {client.managementSplits.map((split) => (
                    <div key={split.id} className="text-sm">
                      <span>{split.user.name}</span>
                      <span className="text-gray-500 ml-2">
                        {split.role === "CLIENT_MANAGER" ? "Client Manager" : "Project Manager"} - {split.splitPercent}%{split.fixedAmount ? ` + ${formatCurrency(split.fixedAmount)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {client.referrerName && (
              <div>
                <span className="text-sm text-gray-600">Referrer: </span>
                <span>{client.referrerName}</span>
                {client.referrerContactInfo && (
                  <div className="mt-1 text-sm text-gray-500">{client.referrerContactInfo}</div>
                )}
              </div>
            )}
            <div>
              <span className="text-sm text-gray-600">Created: </span>
              <span>{formatDate(client.createdAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Statistics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <span className="text-sm text-gray-600">Total Proposals: </span>
              <span className="font-semibold">{client.proposals.length}</span>
            </div>
            <div>
              <span className="text-sm text-gray-600">Total Invoices: </span>
              <span className="font-semibold">{client.bills.length}</span>
            </div>
            <div>
              <span className="text-sm text-gray-600">Total Projects: </span>
              <span className="font-semibold">{client.projects?.length || 0}</span>
            </div>
            <div>
              <span className="text-sm text-gray-600">Total Revenue: </span>
              <span className="font-semibold">
                {formatCurrency(
                  client.bills
                    .filter((b) => b.status === "PAID")
                    .reduce((sum, b) => sum + b.amount, 0)
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Bills</CardTitle>
              <Link href="/dashboard/bills/new">
                <Button size="sm" variant="outline">
                  New Bill
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {client.bills.length === 0 ? (
              <p className="text-sm text-gray-500">No bills yet</p>
            ) : (
              <div className="space-y-2">
                {client.bills.slice(0, 5).map((bill) => (
                  <Link
                    key={bill.id}
                    href={`/dashboard/bills/${bill.id}`}
                    className="block p-2 rounded hover:bg-gray-50"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium">
                          {formatCurrency(bill.amount)}
                        </p>
                        <p className="text-sm text-gray-500">
                          {bill.status} • {formatDate(bill.createdAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Compensation Eligibility Section (Admin only) */}
      {session?.user.role === UserRole.ADMIN && (
        <Card className="mt-8">
          <CompensationEligibilityManager
            clientId={id}
            isAdmin={true}
          />
        </Card>
      )}
    </div>
  )
}

