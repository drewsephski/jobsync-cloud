import { z } from "zod"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createMatcher } from "../lib/ai/matching"
import { createDiscoveryWorker } from "../lib/domain/discovery/worker"
import { createTriggerHandler } from "./trigger-handler"
let worker: ReturnType<typeof createDiscoveryWorker> | undefined
const handler = {
  fetch: createTriggerHandler(() => {
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
      objectCreated: async () => {
        throw new Error("unsupported_trigger")
      },
    }
  }),
}

export default handler
