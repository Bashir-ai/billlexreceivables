import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const disabledPrefixes = [
  "/dashboard/projects",
  "/dashboard/todos",
  "/dashboard/proposals",
  "/dashboard/approvals",
  "/dashboard/timesheets",
  "/proposals",
]

const disabledApiPrefixes = [
  "/api/projects",
  "/api/todos",
  "/api/proposals",
  "/api/approvals",
  "/api/timesheets",
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (disabledPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return NextResponse.redirect(url)
  }

  if (disabledApiPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.json(
      { error: "Module disabled in CRM + Receivables mode" },
      { status: 410 }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*", "/proposals/:path*"],
}

