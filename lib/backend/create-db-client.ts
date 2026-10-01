import { PrismaNeon } from "@prisma/adapter-neon"
import { PrismaClient } from "../generated/prisma/client"

export function createDatabaseClient(connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaNeon({ connectionString }),
    // Allow bounded pool contention when duplicate worker invocations arrive.
    // This does not extend the execution deadline of an acquired transaction.
    transactionOptions: { maxWait: 10_000 },
  })
}
