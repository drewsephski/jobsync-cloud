import { z } from "zod"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createMatcher } from "../lib/ai/matching"
import { createDiscoveryWorker } from "../lib/domain/discovery/worker"
import { createTriggerHandler } from "./trigger-handler"
import { createDiscoveryWakeHandler } from "./discovery-wake-handler"
let worker: ReturnType<typeof createDiscoveryWorker> | undefined
const getWorker = () => {
  if (!worker) {
    const env = z
      .object({
        DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
        OPENROUTER_API_KEY: z.string().min(1),
      })
      .parse(process.env)
    worker = createDiscoveryWorker(
      createDatabaseClient(env.DATABASE_URL),
      createMatcher(env.OPENROUTER_API_KEY)
    )
  }
  return {
    recover: worker.recover,
    wake: worker.wake,
    objectCreated: async () => {
      throw new Error("unsupported_trigger")
    },
  }
}
const triggerHandler = createTriggerHandler(getWorker)
const wakeHandler = createDiscoveryWakeHandler(getWorker)
const handler = {
  fetch(request: Request) {
    if (new URL(request.url).pathname === "/wake") return wakeHandler(request)
    return triggerHandler(request)
  },
}

export default handler
