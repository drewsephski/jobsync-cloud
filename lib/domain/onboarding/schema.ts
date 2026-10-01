import { z } from "zod"
import { resumeSchema } from "../../ai/resume-schema"

// Evidence belongs to the immutable AI source, not to user-authored facts.
export const resumeContentSchema = resumeSchema.extend({
  employment: z
    .array(resumeSchema.shape.employment.element.omit({ evidence: true }))
    .max(30),
  education: z
    .array(resumeSchema.shape.education.element.omit({ evidence: true }))
    .max(20),
  credentials: z
    .array(resumeSchema.shape.credentials.element.omit({ evidence: true }))
    .max(30),
})
export type ResumeContent = z.infer<typeof resumeContentSchema>
export function editableContent(value: unknown): ResumeContent {
  const data = resumeSchema.safeParse(value)
  if (!data.success) return resumeContentSchema.parse(value)
  const withoutEvidence = (entry: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(entry).filter(([key]) => key !== "evidence")
    )
  return resumeContentSchema.parse({
    ...data.data,
    employment: data.data.employment.map(withoutEvidence),
    education: data.data.education.map(withoutEvidence),
    credentials: data.data.credentials.map(withoutEvidence),
  })
}
export const targetSchema = z.strictObject({
  targetTitle: z.string().trim().min(1).max(120),
  location: z.string().trim().max(500).nullable(),
  remotePreferred: z.boolean().nullable(),
  minimumCompensationUsd: z.number().int().min(0).max(10_000_000).nullable(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(30),
})
export const editSchema = z.strictObject({
  expectedVersionId: z.uuid(),
  data: resumeContentSchema,
})
export const confirmSchema = z.strictObject({ expectedVersionId: z.uuid() })
export const preferencesSchema = z
  .strictObject({
    expectedVersionId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    targets: z.array(targetSchema).min(1).max(10),
    complete: z.boolean(),
  })
  .refine(
    ({ targets }) =>
      new Set(targets.map((target) => target.targetTitle.toLowerCase()))
        .size === targets.length,
    { message: "Choose distinct target roles" }
  )
