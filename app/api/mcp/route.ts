import { db } from "@/lib/db"
import { serverEnv } from "@/lib/server-env"
import { createMcpHandler } from "@/lib/mcp/http"
export const runtime = "nodejs"
export const maxDuration = 60
export const POST = createMcpHandler(db, serverEnv.APP_ORIGIN)
// Stateless request/response transport does not maintain an SSE subscription
// or a deletable session. Streamable HTTP clients may probe GET.
export function GET() {
  return new Response(null, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  })
}
export const DELETE = GET
