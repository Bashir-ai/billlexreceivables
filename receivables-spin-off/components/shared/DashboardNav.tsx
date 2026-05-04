"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { UserRole } from "@prisma/client"
import { 
  LayoutDashboard, 
  Receipt, 
  Users, 
  Settings,
  LogOut,
  Wallet,
  BarChart3,
  UserPlus
} from "lucide-react"

interface DashboardNavProps {
  user: {
    id: string
    email: string
    name: string
    role: UserRole
  }
}

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER", "STAFF", "CLIENT"] },
  { name: "Invoices", href: "/dashboard/bills", icon: Receipt, roles: ["ADMIN", "MANAGER", "STAFF", "CLIENT"] },
  { name: "Clients", href: "/dashboard/clients", icon: Users, roles: ["ADMIN", "MANAGER", "STAFF"] },
  { name: "Leads", href: "/dashboard/leads", icon: UserPlus, roles: ["ADMIN", "MANAGER", "STAFF"] },
  { name: "Accounts", href: "/dashboard/accounts", icon: Wallet, roles: ["ADMIN", "MANAGER", "STAFF", "EXTERNAL"] },
  { name: "Reports", href: "/dashboard/reports", icon: BarChart3, roles: ["ADMIN", "MANAGER", "STAFF"] },
  { name: "Settings", href: "/dashboard/settings", icon: Settings, roles: ["ADMIN", "MANAGER", "STAFF", "CLIENT"] },
]

export function DashboardNav({ user }: DashboardNavProps) {
  const pathname = usePathname()
  const navigationArray = Array.isArray(navigation) ? navigation : []
  const filteredNav = navigationArray.filter((item) => 
    item.roles.includes(user.role)
  )

  return (
    <nav className="bg-white border-b border-gray-200" role="navigation" aria-label="Main navigation">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-8">
            <Link href="/dashboard" className="text-xl font-bold text-primary" aria-label="Go to Dashboard home">
              Billlex Receivables
            </Link>
            <div className="flex space-x-4" role="menubar" aria-label="Navigation menu">
              {Array.isArray(filteredNav) && filteredNav.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    role="menuitem"
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.name}</span>
                  </Link>
                )
              })}
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-700" aria-label={`Logged in as ${user.name}`}>{user.name}</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded" aria-label={`User role: ${user.role}`}>
              {user.role}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
              aria-label="Sign out of your account"
            >
              <LogOut className="h-4 w-4 mr-2" aria-hidden="true" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </nav>
  )
}




