import type { Instrumentation } from "next"

/**
 * Keep production request-error logs useful for routing and recovery without
 * copying exception messages, request URLs, headers, bodies, or user IDs into
 * the Vercel log stream.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  _error,
  _request,
  context
) => {
  const route = context.routePath
    .replace(/[^a-zA-Z0-9/_[\].-]/g, "")
    .slice(0, 160)
  console.error(
    JSON.stringify({
      event: "request_error",
      errorId: crypto.randomUUID(),
      route: route || "unknown",
      routeType: context.routeType,
      routerKind: context.routerKind,
      runtime: process.env.NEXT_RUNTIME ?? "unknown",
    })
  )
}
