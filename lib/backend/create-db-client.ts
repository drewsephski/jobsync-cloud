import { PrismaNeon } from "@prisma/adapter-neon"
import { PrismaClient } from "../generated/prisma/client"

export function createDatabaseClient(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })
}
