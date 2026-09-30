import "server-only"
import { db } from "@/lib/db"
import { createUploadService } from "@/lib/storage/upload-service"
import { createUploadRepository } from "@/lib/domain/resume-upload/repository"
import { s3Transport } from "@/lib/storage/s3-transport"

export const uploadRepository = createUploadRepository(db)
export const resumeUploads = createUploadService(uploadRepository, s3Transport)
