import "server-only"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { PrismaClient } from "../generated/prisma/client"
import { UploadError } from "../domain/resume-upload/service"
import { bearerToken, resolveMcpToken } from "./tokens"
import { createJobSyncMcpServer } from "./server"

export function createMcpHandler(db: PrismaClient, origin: string) {
  return async (request: Request) => {
    const headers: Record<string, string> = { "Cache-Control": "no-store" }
    try {
      if (process.env.MCP_ENABLED === "false")
        return new Response(null, { status: 404, headers })
      const requestOrigin = request.headers.get("origin")
      if (requestOrigin && requestOrigin !== origin)
        throw new UploadError("invalid_origin", 403)
      if (new URL(request.url).host !== new URL(origin).host)
        throw new UploadError("invalid_host", 403)
      const token = bearerToken(request)
      if (!token) throw new UploadError("invalid_token", 401)
      const principal = await resolveMcpToken(db, token)
      const server = createJobSyncMcpServer(db, principal, () =>
        resolveMcpToken(db, token, false)
      )
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: 256_000,
      })
      try {
        await server.connect(transport)
        const response = await transport.handleRequest(request)
        response.headers.set("Cache-Control", "no-store")
        return response
      } finally {
        await server.close()
      }
    } catch (error) {
      const status = error instanceof UploadError ? error.status : 503
      if (status === 401)
        headers["WWW-Authenticate"] = 'Bearer realm="JobSync MCP"'
      if (status === 429) headers["Retry-After"] = "60"
      return Response.json(
        {
          error: error instanceof UploadError ? error.code : "mcp_unavailable",
        },
        { status, headers }
      )
    }
  }
}
