import { z } from "zod"
export const statuses = [
  "saved",
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const
export type ApplicationStatus = (typeof statuses)[number]
export const statusLabels: Record<ApplicationStatus, string> = {
  saved: "Saved / Preparing",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
}
export const activeStatuses: ApplicationStatus[] = [
  "saved",
  "applied",
  "interview",
  "offer",
]
const optionalText = (max: number) => z.string().trim().max(max).nullable()
export const dateSchema = z.iso
  .date()
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v)
const urlSchema = z
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value)
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
  })
  .nullable()
export const detailsSchema = z.strictObject({
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().max(300),
  postingUrl: urlSchema,
  salary: optionalText(200),
  notes: optionalText(10000),
  appliedOn: dateSchema.nullable(),
  followUpOn: dateSchema.nullable(),
  nextAction: optionalText(300),
  resumeVersionId: z.uuid().nullable(),
})
const identity = {
  applicationId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
}
export const applicationMutationSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("track"),
    postingId: z.uuid(),
    matchId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal("create"),
    creationKey: z.uuid(),
    details: detailsSchema,
    status: z.enum(statuses),
    stageName: optionalText(120),
  }),
  z.strictObject({
    action: z.literal("edit"),
    ...identity,
    details: detailsSchema,
  }),
  z.strictObject({
    action: z.literal("transition"),
    ...identity,
    status: z.enum(statuses),
    stageName: optionalText(120),
    occurredOn: dateSchema,
    note: optionalText(2000),
  }),
  z.strictObject({
    action: z.literal("archive"),
    ...identity,
    archived: z.boolean(),
  }),
  z.strictObject({ action: z.literal("delete"), ...identity }),
])
export type ApplicationDetails = z.infer<typeof detailsSchema>
// Dates are user calendar dates, never converted to the browser's timezone.
export function calendarToday(timezone = "UTC", now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now)
    const part = (type: string) => parts.find((p) => p.type === type)!.value
    return `${part("year")}-${part("month")}-${part("day")}`
  } catch {
    return now.toISOString().slice(0, 10)
  }
}
