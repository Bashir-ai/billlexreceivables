"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { UserRole } from "@prisma/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  LayoutDashboard,
  Receipt,
  Users,
  Settings,
  LogOut,
  Wallet,
  BarChart3,
  UserPlus,
  Menu,
  Scale,
} from "lucide-react"
import { useSidebar } from "./SidebarContext"

interface MobileSidebarProps {
  user: {
    id: string
    email: string
    name: string
    role: UserRole
  }
}

// Navigation structure with groups (same as Sidebar)
const navigationGroups = [
  {
    name: "Main",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER", "STAFF", "CLIENT"] },
    ],
  },
  {
    name: "Work",
    items: [
      { name: "Invoices", href: "/dashboard/bills", icon: Receipt, roles: ["ADMIN", "MANAGER", "STAFF", "CLIENT"] },
    ],
  },
  {
    name: "Management",
    items: [
      { name: "Clients", href: "/dashboard/clients", icon: Users, roles: ["ADMIN", "MANAGER", "STAFF"] },
      { name: "Leads", href: "/dashboard/leads", icon: UserPlus, roles: ["ADMIN", "MANAGER", "STAFF"] },
      { name: "Accounts", href: "/dashboard/accounts", icon: Wallet, roles: ["ADMIN", "MANAGER", "STAFF"] },
      { name: "Reports", href: "/dashboard/reports", icon: BarChart3, roles: ["ADMIN", "MANAGER", "STAFF"] },
    ],
  },
  {
    name: "System",
    items: [
      { name: "Settings", href: "/dashboard/settings", icon: Settings, roles: ["ADMIN", "MANAGER", "STAFF", "CLIENT"] },
    ],
  },
]

export function MobileHeader({ user }: MobileSidebarProps) {
  const { isMobileOpen, setMobileOpen } = useSidebar()
  const pathname = usePathname()

  // Filter navigation items by role
  const filteredGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.roles.includes(user.role)),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <>
      {/* Mobile Header Bar */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 h-14 bg-background border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
          <Link href="/dashboard" className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            <span className="font-semibold">Billlex Receivables</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium">
            {user.name?.charAt(0)?.toUpperCase() || "U"}
          </div>
        </div>
      </header>

      {/* Mobile Sheet Navigation */}
      <Sheet open={isMobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="h-14 border-b border-border px-4 flex flex-row items-center justify-start gap-2">
            <Scale className="h-5 w-5 text-primary" />
            <SheetTitle className="text-base font-semibold">Billlex Receivables</SheetTitle>
          </SheetHeader>
          
          <nav className="flex-1 overflow-y-auto sidebar-scrollbar py-4 px-3">
            {filteredGroups.map((group, groupIndex) => (
              <div key={group.name} className={groupIndex > 0 ? "mt-6" : ""}>
                <h3 className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {group.name}
                </h3>
                <ul className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const isActive = pathname === item.href || pathname.startsWith(item.href + "/")

                    return (
                      <li key={item.name}>
                        <Link
                          href={item.href}
                          onClick={() => setMobileOpen(false)}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          )}
                        >
                          <Icon className="h-5 w-5 flex-shrink-0" />
                          <span>{item.name}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <Separator />
          
          {/* User section */}
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm font-medium flex-shrink-0">
                {user.name?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.role}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="h-5 w-5" />
              <span>Sign Out</span>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
