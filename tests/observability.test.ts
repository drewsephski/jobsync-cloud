import assert from "node:assert/strict"
import { mock, test } from "node:test"
import { onRequestError } from "../instrumentation"
import { privateRead } from "../lib/backend/private-read"

test("request-error events exclude error and request content", async () => {
  const privateMarkers = [
    "private-resume-canary-7d3b",
    "private-prompt-canary-a912",
    "private-response-canary-4cc1",
    "private-email-canary-81ef@example.invalid",
    "private-signed-url-canary-f2a6",
    "private-credential-canary-991d",
  ]
  const error = new Error(
    `Failure ${privateMarkers.join(" ")}`
  )
  const request = {
    path: `/api/resume?content=${encodeURIComponent(privateMarkers[0]!)}`,
    method: "POST",
    headers: {
      authorization: `Bearer ${privateMarkers[5]}`,
      cookie: privateMarkers[3]!,
    },
  }
  const context = {
    routePath: "/api/resume/[uploadId]",
    routeType: "route" as const,
    routerKind: "App Router" as const,
    renderSource: "react-server-components" as const,
    revalidateReason: undefined,
  }
  const emitted: string[] = []
  const restore = mock.method(console, "error", (...values: unknown[]) => {
    emitted.push(values.map(String).join(" "))
  })

  try {
    await onRequestError(error, request, context)
  } finally {
    restore.mock.restore()
  }

  assert.equal(emitted.length, 1)
  const event = JSON.parse(emitted[0]!) as Record<string, unknown>
  assert.deepEqual(Object.keys(event).sort(), [
    "errorId",
    "event",
    "route",
    "routeType",
    "routerKind",
    "runtime",
  ])
  assert.equal(event.event, "request_error")
  assert.equal(event.route, "/api/resume/[uploadId]")
  assert.match(String(event.errorId), /^[0-9a-f-]{36}$/)

  const serialized = JSON.stringify(event)
  for (const marker of privateMarkers) {
    assert.equal(serialized.includes(marker), false, `logged ${marker}`)
  }
})

test("private reads sanitize failures before request-error logging", async () => {
  const privateMarkers = [
    "private-db-message-canary-2ba1",
    "private-db-cause-canary-1f80",
    "private-db-stack-canary-6d03",
  ]
  let forwardedError: unknown

  await assert.rejects(
    privateRead(async () => {
      const error = new Error(privateMarkers[0]!, {
        cause: new Error(privateMarkers[1]!),
      })
      error.stack = `Error: ${privateMarkers[0]}\n    at ${privateMarkers[2]}`
      throw error
    }),
    (error: unknown) => {
      forwardedError = error
      return true
    }
  )

  assert.ok(forwardedError instanceof Error)
  assert.equal(forwardedError.message, "workspace_unavailable")
  assert.equal(forwardedError.cause, undefined)
  for (const marker of privateMarkers) {
    assert.equal(forwardedError.stack?.includes(marker), false)
  }

  const emitted: string[] = []
  const restore = mock.method(console, "error", (...values: unknown[]) => {
    emitted.push(values.map(String).join(" "))
  })
  try {
    await onRequestError(forwardedError, {
      path: "/dashboard/resume",
      method: "GET",
      headers: {},
    }, {
      routePath: "/dashboard/resume",
      routeType: "render",
      routerKind: "App Router",
      revalidateReason: undefined,
    })
  } finally {
    restore.mock.restore()
  }

  assert.equal(emitted.length, 1)
  for (const marker of privateMarkers) {
    assert.equal(emitted[0]!.includes(marker), false)
  }
})
