import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createAccountDeletion } from "../lib/domain/account/deletion"
import { accountCleanup } from "../lib/domain/account/providers"
import { createTriggerHandler } from "./trigger-handler"

let service: ReturnType<typeof createAccountDeletion> | undefined
const handler = {
  fetch: createTriggerHandler(() => {
    if (!process.env.DATABASE_URL) throw new Error("invalid_worker_environment")
    service ??= createAccountDeletion(
      createDatabaseClient(process.env.DATABASE_URL),
      accountCleanup()
    )
    return {
      recover: service.recover,
      objectCreated: async () => {
        throw new Error("unsupported_trigger")
      },
    }
  }),
}

export default handler
