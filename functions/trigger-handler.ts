import { z } from "zod"
import { STORAGE_BUCKET } from "../lib/backend/create-storage-client"

const envelope = z.object({
  version: z.literal(1),
  invocation_id: z.string().min(1).max(256),
  trigger: z.object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(256),
    type: z.enum(["storage_object_created", "schedule"]),
  }),
  data: z.unknown(),
})
const objectData = z.object({
  bucket_name: z.literal(STORAGE_BUCKET),
  object_key: z
    .string()
    .min(1)
    .max(1024)
    .refine((key) => !/[\u0000-\u001f\u007f]/.test(key)),
})
const scheduleData = z.object({
  scheduled_at: z.iso.datetime({ offset: true }),
})
export interface WorkerOperations {
  objectCreated(key: string): Promise<unknown>
  recover(): Promise<unknown>
}
export function createTriggerHandler(getWorker: () => WorkerOperations) {
  return async (request: Request) => {
    const path = new URL(request.url).pathname
    if (!["/object-created", "/recover"].includes(path))
      return Response.json({ error: "not_found" }, { status: 404 })
    if (request.method !== "POST")
      return Response.json({ error: "method_not_allowed" }, { status: 405 })
    const invocationId = request.headers.get("X-Neon-Trigger-Invocation-Id")
    if (!invocationId || invocationId.length > 256)
      return Response.json({ error: "trigger_required" }, { status: 403 })
    let body: z.infer<typeof envelope>
    try {
      // Trigger bodies are tiny; never buffer an arbitrary direct caller body.
      const reader = request.body?.getReader()
      if (!reader) throw new Error()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 8192) throw new Error()
          chunks.push(value)
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
      body = envelope.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      if (body.invocation_id !== invocationId) throw new Error()
      if (path === "/object-created") {
        if (body.trigger.type !== "storage_object_created") throw new Error()
        objectData.parse(body.data)
      } else {
        if (body.trigger.type !== "schedule") throw new Error()
        scheduleData.parse(body.data)
      }
    } catch {
      return Response.json({ error: "invalid_trigger" }, { status: 400 })
    }
    try {
      const worker = getWorker()
      const result =
        path === "/object-created"
          ? await worker.objectCreated(objectData.parse(body.data).object_key)
          : await worker.recover()
      console.info(
        JSON.stringify({
          invocationId,
          triggerType: body.trigger.type,
          status: "handled",
        })
      )
      return Response.json(result)
    } catch {
      console.info(
        JSON.stringify({
          invocationId,
          triggerType: body.trigger.type,
          errorCode: "dependency_unavailable",
        })
      )
      return Response.json({ error: "dependency_unavailable" }, { status: 503 })
    }
  }
}
