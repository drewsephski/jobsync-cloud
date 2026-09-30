import { auth } from "@/lib/auth/server"
import { NextResponse, NextRequest } from "next/server"

const guard = auth.middleware({
  // Redirects unauthenticated users to sign-in page
  loginUrl: "/auth/sign-in",
})

export default async function proxy(request: NextRequest) {
  try {
    // Check revocation before reaching server components: the SDK cannot clear
    // expired session cookies from a read-only Server Component cookie store.
    const guardUrl = new URL(request.url)
    guardUrl.searchParams.set("disableCookieCache", "true")
    const response = await guard(
      new NextRequest(guardUrl, { headers: request.headers })
    )
    const location = response.headers.get("location")
    if (
      location &&
      new URL(location, request.url).pathname === "/auth/sign-in"
    ) {
      // The installed SDK guard collapses non-2xx lookups into login redirects.
      // Confirm the nullable session through its supported request-based handler
      // so provider outages fail visibly instead of masquerading as logout.
      const url = new URL("/api/auth/get-session", request.url)
      url.searchParams.set("disableCookieCache", "true")
      const headers = new Headers(request.headers)
      headers.delete("content-type")
      headers.delete("content-length")
      headers.delete("transfer-encoding")
      const session = await auth.handler().GET(new Request(url, { headers }), {
        params: Promise.resolve({ path: ["get-session"] }),
      })
      if (!session.ok) return unavailable()
      // Malformed upstream responses are failures too, not anonymous sessions.
      const data: unknown = await session.json()
      if (data !== null) return unavailable()
      const loginUrl = new URL(location, request.url)
      loginUrl.searchParams.delete("disableCookieCache")
      response.headers.set("location", loginUrl.toString())
    }
    return response
  } catch {
    return unavailable()
  }
}

function unavailable() {
  return new NextResponse(
    "Authentication service unavailable. Please try again.",
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    }
  )
}

export const config = {
  matcher: [
    // Protected routes requiring authentication
    "/account/:path*",
    "/dashboard/:path*",
    "/onboarding/:path*",
  ],
}
