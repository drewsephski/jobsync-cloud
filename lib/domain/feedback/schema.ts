import { z } from "zod"
export const feedbackCategories = {
  confusing_ux: "Confusing experience",
  bad_match: "Bad job match",
  missing_company: "Missing company",
  bug: "Bug or problem",
  general: "General feedback",
} as const
export const feedbackSchema = z.strictObject({
  category: z.enum(
    Object.keys(feedbackCategories) as [
      keyof typeof feedbackCategories,
      ...(keyof typeof feedbackCategories)[],
    ]
  ),
  message: z.string().trim().min(10).max(2000),
  submissionKey: z.uuid(),
})
