import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/utils"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Receipt, Users, UserPlus, Wallet } from "lucide-react"
import { NotificationsBox } from "@/components/dashboard/NotificationsBox"
import { InvoiceAnalyticsPanel } from "@/components/dashboard/InvoiceAnalyticsPanel"
import { getNotifications, Notification } from "@/lib/notifications"

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  // Redirect EXTERNAL users to accounts page (must be outside try-catch)
  if (session?.user.role === "EXTERNAL") {
    redirect("/dashboard/accounts")
  }

  try {

    // Fetch notifications server-side
    let notificationsData: { count: number; notifications: Notification[] } = { count: 0, notifications: [] }
    if (session) {
      const notificationsResult = await getNotifications(session.user.id, session.user.role)
      notificationsData = {
        count: notificationsResult.count || 0,
        notifications: Array.isArray(notificationsResult.notifications) ? notificationsResult.notifications : []
      }
    }

    // Build base where clauses for role-based filtering
    const clientWhere = session?.user.role === "CLIENT" 
      ? { client: { email: session?.user.email } }
      : undefined

    const [
      billsCount,
      clientsCount,
      leadsCount,
      totalRevenue,
      invoicedNotPaid,
    ] = await Promise.all([
      prisma.bill.count({
        where: {
          deletedAt: null,
          ...(clientWhere || {})
        },
      }).catch(() => 0),
      prisma.client.count({
        where: {
          deletedAt: null,
        },
      }).catch(() => 0),
      prisma.lead.count({
        where: {
          deletedAt: null,
          archivedAt: null,
          status: { not: "CONVERTED" },
          convertedToClientId: null,
        },
      }).catch(() => 0),
      prisma.bill.aggregate({
        where: {
          status: "PAID",
          ...(session?.user.role === "CLIENT" 
            ? { client: { email: session?.user.email } }
            : {})
        },
        _sum: {
          amount: true,
        },
      }).catch(() => ({ _sum: { amount: null } })),
      prisma.bill.aggregate({
        where: {
          status: { in: ["SUBMITTED", "APPROVED"] },
          ...(session?.user.role === "CLIENT" 
            ? { client: { email: session?.user.email } }
            : {})
        },
        _sum: {
          amount: true,
        },
      }).catch(() => ({ _sum: { amount: null } })),
    ])

  const stats: Array<{
    name: string
    value: number
    icon: any
    href: string
    color: string
    bgColor: string
    description: string
  }> = [
    {
      name: "Invoices",
      value: billsCount,
      icon: Receipt,
      href: "/dashboard/bills",
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
      description: "Total invoices"
    },
    {
      name: "Clients",
      value: clientsCount,
      icon: Users,
      href: "/dashboard/clients",
      color: "text-amber-600",
      bgColor: "bg-amber-50",
      description: "Registered clients"
    },
    {
      name: "Leads",
      value: leadsCount,
      icon: UserPlus,
      href: "/dashboard/leads",
      color: "text-indigo-600",
      bgColor: "bg-indigo-50",
      description: "Open CRM leads"
    },
  ]

  const quickActions: Array<{
    name: string
    href: string
    icon: any
  }> = [
    { name: "New Invoice", href: "/dashboard/bills/new", icon: Receipt },
    { name: "New Client", href: "/dashboard/clients/new", icon: Users },
    { name: "New Lead", href: "/dashboard/leads/new", icon: UserPlus },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {session?.user.name}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {session && (
            <NotificationsBox
              initialCount={notificationsData.count}
              initialNotifications={Array.isArray(notificationsData.notifications) ? notificationsData.notifications : []}
            />
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.isArray(stats) && stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Link key={stat.name} href={stat.href}>
              <Card className="group hover:shadow-md transition-all duration-200 hover:border-border/80">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">
                        {stat.name}
                      </p>
                      <p className="text-3xl font-semibold tracking-tight">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.description}</p>
                    </div>
                    <div className={`p-2.5 rounded-lg ${stat.bgColor} transition-transform duration-200 group-hover:scale-110`}>
                      <Icon className={`h-5 w-5 ${stat.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {session?.user.role !== "CLIENT" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {Array.isArray(quickActions) && quickActions.map((action) => {
                  const Icon = action.icon
                  return (
                    <Link key={action.name} href={action.href}>
                      <Button
                        variant="outline"
                        className="w-full h-auto py-4 flex flex-col items-center gap-2 hover:bg-accent hover:border-accent transition-colors"
                      >
                        <Icon className="h-5 w-5 text-muted-foreground" />
                        <span className="text-sm font-medium">{action.name}</span>
                      </Button>
                    </Link>
                  )
                })}
              </div>
            )}
            
            {session?.user.role !== "CLIENT" && (
              <div className="pt-3 space-y-2">
                <Link href="/dashboard/accounts">
                  <Button variant="ghost" className="w-full justify-between group">
                    <span className="flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-muted-foreground" />
                      Manage Accounts
                    </span>
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Receivables Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total paid revenue</span>
              <span className="text-sm font-semibold">{formatCurrency(totalRevenue._sum.amount || 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Outstanding invoices</span>
              <span className="text-sm font-semibold">{formatCurrency(invoicedNotPaid._sum.amount || 0)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <InvoiceAnalyticsPanel />
    </div>
    )
  } catch (error) {
    // Re-throw Next.js redirect errors
    if (error && typeof error === 'object' && 'digest' in error && typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT')) {
      throw error
    }
    console.error("Error loading dashboard:", error)
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Unable to load dashboard data. Please try again later.</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              There was an error connecting to the database. Please check your connection and try again.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }
}
