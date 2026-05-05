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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (disabledPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  // Keep middleware scope narrow to avoid impacting auth/API runtime on Vercel.
  matcher: ["/dashboard/:path*", "/proposals/:path*"],
}

