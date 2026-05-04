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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  LayoutDashboard,
  Receipt,
  Users,
  Settings,
  LogOut,
  Wallet,
  BarChart3,
  UserPlus,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Scale,
  TrendingUp,
} from "lucide-react"

interface SidebarProps {
  user: {
    id: string
    email: string
    name: string
    role: UserRole
  }
  isCollapsed: boolean
  onToggle: () => void
}

// Navigation structure with groups
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
      {
        name: "Operations",
        href: "/dashboard/operations",
        icon: ClipboardList,
        roles: ["ADMIN", "MANAGER", "STAFF"],
      },
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
      {
        name: "Performance vs prior",
        href: "/dashboard/reports/performance",
        icon: TrendingUp,
        roles: ["ADMIN", "MANAGER", "STAFF"],
      },
    ],
  },
  {
    name: "System",
    items: [
      { name: "Settings", href: "/dashboard/settings", icon: Settings, roles: ["ADMIN", "MANAGER", "STAFF", "CLIENT"] },
    ],
  },
]

export function Sidebar({ user, isCollapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()

  // Filter navigation items by role
  const navigationGroupsArray = Array.isArray(navigationGroups) ? navigationGroups : []
  const filteredGroups = navigationGroupsArray
    .map((group) => ({
      ...group,
      items: Array.isArray(group.items) ? group.items.filter((item) => item.roles.includes(user.role)) : [],
    }))
    .filter((group) => Array.isArray(group.items) && group.items.length > 0)

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out flex flex-col",
          isCollapsed ? "w-16" : "w-60"
        )}
      >
        {/* Logo/Brand */}
        <div className={cn(
          "flex h-16 items-center border-b border-sidebar-border px-4",
          isCollapsed ? "justify-center" : "justify-between"
        )}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/dashboard" className="flex items-center justify-center">
                  <Scale className="h-6 w-6 text-primary" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                Billlex Receivables
              </TooltipContent>
            </Tooltip>
          ) : (
            <Link href="/dashboard" className="flex items-center gap-2">
              <Scale className="h-6 w-6 text-primary" />
              <span className="font-semibold text-sidebar-foreground">Billlex Receivables</span>
            </Link>
          )}
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={onToggle}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto sidebar-scrollbar py-4 px-3">
          {Array.isArray(filteredGroups) && filteredGroups.map((group, groupIndex) => (
            <div key={group.name} className={groupIndex > 0 ? "mt-6" : ""}>
              {!isCollapsed && (
                <h3 className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
                  {group.name}
                </h3>
              )}
              {isCollapsed && groupIndex > 0 && (
                <Separator className="my-3 bg-sidebar-border" />
              )}
              <ul className="space-y-1">
                {Array.isArray(group.items) && group.items.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/")

                  if (isCollapsed) {
                    return (
                      <li key={item.name}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link
                              href={item.href}
                              className={cn(
                                "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                                isActive
                                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                              )}
                            >
                              <Icon className="h-5 w-5" />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {item.name}
                          </TooltipContent>
                        </Tooltip>
                      </li>
                    )
                  }

                  return (
                    <li key={item.name}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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

        {/* User section + Collapse toggle */}
        <div className="border-t border-sidebar-border p-3">
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-sm font-medium">
                    {user.name?.charAt(0)?.toUpperCase() || "U"}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="text-sm">
                    <p className="font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.role}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                  >
                    <LogOut className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign Out</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    onClick={onToggle}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Expand Sidebar</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-sm font-medium flex-shrink-0">
                  {user.name?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-sidebar-foreground truncate">
                    {user.name}
                  </p>
                  <p className="text-xs text-sidebar-foreground/60 truncate">
                    {user.role}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 px-3 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut className="h-5 w-5" />
                <span>Sign Out</span>
              </Button>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}
