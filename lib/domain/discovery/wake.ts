import "server-only"
import { z } from "zod"

const wakeInputSchema = z
  .strictObject({
    boardId: z.uuid().optional(),
    ownerUserId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .optional(),
  })
  .refine(
    (value) => value.boardId !== undefined || value.ownerUserId !== undefined
  )

export type DiscoveryWakeInput = z.infer<typeof wakeInputSchema>

type WakeEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "DISCOVERY_WORKER_URL" | "DISCOVERY_WAKE_SECRET">
>

type WakeDependencies = {
  env?: WakeEnvironment
  fetcher?: typeof fetch
  log?: (event: string) => void
}

const WAKE_TIMEOUT_MS = 55_000

function logWakeFailure(log: (event: string) => void) {
  log(JSON.stringify({ event: "discovery_wake", status: "unavailable" }))
}

/** Best-effort wake; committed Postgres work remains recoverable by schedule. */
export async function wakeDiscovery(
  input: DiscoveryWakeInput,
  dependencies: WakeDependencies = {}
): Promise<{ ok: boolean }> {
  const env = dependencies.env ?? process.env
  const fetcher = dependencies.fetcher ?? fetch
  const log = dependencies.log ?? ((event) => console.info(event))

  try {
    const parsed = wakeInputSchema.parse(input)
    const endpoint = env.DISCOVERY_WORKER_URL
    const secret = env.DISCOVERY_WAKE_SECRET
    if (!endpoint || !secret || secret.length < 32 || secret.length > 256)
      throw new Error("wake_configuration_unavailable")

    const baseUrl = new URL(endpoint)
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    )
      throw new Error("wake_configuration_unavailable")

    const response = await fetcher(new URL("/wake", baseUrl), {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed),
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error("wake_rejected")
    return { ok: true }
  } catch {
    logWakeFailure(log)
    return { ok: false }
  }
}
