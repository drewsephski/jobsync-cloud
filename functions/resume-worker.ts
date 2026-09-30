import { z } from "zod"
import { createDatabaseClient } from "../lib/backend/create-db-client"
import { createStorageClient } from "../lib/backend/create-storage-client"
import { createS3Transport } from "../lib/backend/s3-transport"
import { createObjectDownloader } from "../lib/backend/download-object"
import { createResumeWorker } from "../lib/domain/processing-run/resume-worker"
import { createTriggerHandler, type WorkerOperations } from "./trigger-handler"

let worker: WorkerOperations | undefined
function getWorker() {
  if (worker) return worker
  const result = z
    .object({
      DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
      AWS_ENDPOINT_URL_S3: z.url({ protocol: /^https$/ }),
      AWS_REGION: z.string().min(1),
      AWS_ACCESS_KEY_ID: z.string().min(1),
      AWS_SECRET_ACCESS_KEY: z.string().min(1),
    })
    .safeParse(process.env)
  if (!result.success) throw new Error("invalid_worker_environment")
  const env = result.data
  const db = createDatabaseClient(env.DATABASE_URL)
  const storage = createStorageClient({
    endpoint: env.AWS_ENDPOINT_URL_S3,
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  })
  worker = createResumeWorker(
    db,
    createS3Transport(storage),
    createObjectDownloader(storage)
  )
  return worker
}
const handler = { fetch: createTriggerHandler(getWorker) }
export default handler
