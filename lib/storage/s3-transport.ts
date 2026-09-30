import "server-only"
import { storageClient } from "@/lib/storage/client"
import { createS3Transport } from "@/lib/backend/s3-transport"
export const s3Transport = createS3Transport(storageClient)
