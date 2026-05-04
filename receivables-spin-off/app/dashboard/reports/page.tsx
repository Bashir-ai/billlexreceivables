"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { formatCurrency } from "@/lib/utils"
import { Clock, Users, Wallet } from "lucide-react"
import { ClientReports } from "@/components/reports/ClientReports"

interface UserStatistics {
  userId: string
  userName: string
  userEmail: string
  billedHours: number
  billedAmount: number
  clientsFound: number
  clientsManaged: number
  projectsManaged: number
  todosAssigned: number
  todosOngoing: number
  todosCompleted: number
  todosReassigned: number
  finderFeesEarned: number
  finderFeesPaid: number
  finderFeesPending: number
}

export default function ReportsPage() {
  const { data: session } = useSession()
  const [activeTab, setActiveTab] = useState<"users" | "clients">("users")
  const [loading, setLoading] = useState(true)
  const [statistics, setStatistics] = useState<UserStatistics[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>("")
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [startDate, setStartDate] = useState<string>("")
  const [endDate, setEndDate] = useState<string>("")

  useEffect(() => {
    if (!session) return

    // Fetch users list if admin
    if (session.user.role === "ADMIN") {
      fetch("/api/users")
        .then((res) => res.json())
        .then((data) => {
          setUsers(data.filter((u: any) => u.role !== "CLIENT"))
        })
        .catch(console.error)
    }
  }, [session])

  useEffect(() => {
    if (!session) return

    setLoading(true)
    const params = new URLSearchParams()
    if (startDate) params.set("startDate", startDate)
    if (endDate) params.set("endDate", endDate)

    if (session.user.role === "ADMIN") {
      // Fetch all users statistics
      fetch(`/api/users/statistics?${params.toString()}`)
        .then((res) => res.json())
        .then((data) => {
          setStatistics(data)
          setLoading(false)
        })
        .catch((err) => {
          console.error(err)
          setLoading(false)
        })
    } else {
      // Fetch current user statistics
      fetch(`/api/users/${session.user.id}/statistics?${params.toString()}`)
        .then((res) => res.json())
        .then((data) => {
          setStatistics([data])
          setLoading(false)
        })
        .catch((err) => {
          console.error(err)
          setLoading(false)
        })
    }
  }, [session, startDate, endDate])

  if (!session) {
    return <div>Loading...</div>
  }

  const isAdmin = session.user.role === "ADMIN"
  const displayStats = selectedUserId && isAdmin
    ? statistics.filter((s) => s.userId === selectedUserId)
    : statistics

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-gray-600 mt-2">Comprehensive statistics and performance metrics</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6 border-b">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab("users")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "users"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            Users
          </button>
          <button
            onClick={() => setActiveTab("clients")}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === "clients"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            Clients
          </button>
        </nav>
      </div>

      {activeTab === "clients" ? (
        <ClientReports />
      ) : (
        <>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            {isAdmin && (
              <div>
                <label className="text-sm font-medium mr-2">User:</label>
                <Select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                >
                  <option value="">All Users</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium mr-2">Start Date:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border rounded px-2 py-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium mr-2">End Date:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border rounded px-2 py-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div>Loading...</div>
      ) : displayStats.length === 0 ? (
        <p className="text-gray-500">No statistics found</p>
      ) : (
        <div className="space-y-6">
          {displayStats.map((stats) => (
            <Card key={stats.userId}>
              <CardHeader>
                <CardTitle>{stats.userName}</CardTitle>
                <CardDescription>{stats.userEmail}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Billed Hours & Amount */}
                  <div className="space-y-4">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Billed Hours & Services
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Billed Hours:</span>
                        <span className="font-semibold">{stats.billedHours.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Billed Amount:</span>
                        <span className="font-semibold">{formatCurrency(stats.billedAmount)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Clients */}
                  <div className="space-y-4">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Clients
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Clients Found:</span>
                        <span className="font-semibold">{stats.clientsFound}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Clients Managed:</span>
                        <span className="font-semibold">{stats.clientsManaged}</span>
                      </div>
                    </div>
                  </div>

                  {/* Projects */}
                  {/* Finder / management fees */}
                  <div className="space-y-4">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Wallet className="h-4 w-4" />
                      Finder / Management Fees
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total Earned:</span>
                        <span className="font-semibold">{formatCurrency(stats.finderFeesEarned)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total Paid:</span>
                        <span className="font-semibold">{formatCurrency(stats.finderFeesPaid)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Pending:</span>
                        <span className="font-semibold">{formatCurrency(stats.finderFeesPending)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Comparison Table for Admin */}
      {isAdmin && !selectedUserId && statistics.length > 1 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>User Comparison</CardTitle>
            <CardDescription>Side-by-side comparison of all users</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">User</th>
                    <th className="text-right p-2">Billed Hours</th>
                    <th className="text-right p-2">Billed Amount</th>
                    <th className="text-right p-2">Clients Found</th>
                    <th className="text-right p-2">Clients Managed</th>
                    <th className="text-right p-2">Finder Fees Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {statistics.map((stats) => (
                    <tr key={stats.userId} className="border-b">
                      <td className="p-2">{stats.userName}</td>
                      <td className="text-right p-2">{stats.billedHours.toFixed(2)}</td>
                      <td className="text-right p-2">{formatCurrency(stats.billedAmount)}</td>
                      <td className="text-right p-2">{stats.clientsFound}</td>
                      <td className="text-right p-2">{stats.clientsManaged}</td>
                      <td className="text-right p-2">{formatCurrency(stats.finderFeesEarned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
        </>
      )}
    </div>
  )
}




