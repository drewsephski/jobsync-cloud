import "server-only"

import { db } from "@/lib/db"

// Read-only check of every foundation table, including on an empty database.
export async function checkDatabaseHealth(): Promise<void> {
  await db.$transaction([
    db.userProfile.findFirst({ select: { id: true } }),
    db.resume.findFirst({ select: { id: true } }),
    db.resumeVersion.findFirst({ select: { id: true } }),
    db.targetPreference.findFirst({ select: { id: true } }),
    db.processingRun.findFirst({ select: { id: true } }),
    db.aiUsageReservation.findFirst({ select: { id: true } }),
    db.aiUsage.findFirst({ select: { id: true } }),
  ])
}
