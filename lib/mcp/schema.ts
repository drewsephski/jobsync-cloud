import { z } from "zod"

export const mcpScopes = [
  "workspace:read",
  "applications:write",
  "resumes:write",
] as const
export type McpScope = (typeof mcpScopes)[number]
export const tokenCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]),
  scopes: z
    .array(z.enum(mcpScopes))
    .min(1)
    .max(3)
    .refine(
      (scopes) =>
        scopes.includes("workspace:read") &&
        new Set(scopes).size === scopes.length
    ),
})
export const tokenRevokeSchema = z.strictObject({ tokenId: z.uuid() })
export const approvalShape = {
  userApproved: z
    .literal(true)
    .describe(
      "The user explicitly approved these exact changes. Ask before calling."
    ),
}
export const pageShape = {
  offset: z.number().int().min(0).max(100000).default(0),
  limit: z.number().int().min(1).max(50).default(20),
}
export type McpTokenView = {
  id: string
  name: string
  tokenPrefix: string
  scopes: string[]
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
}
