import "server-only"

import { z } from "zod"

const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL_UNPOOLED: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url({ protocol: /^postgres(ql)?$/ }).optional()
  ),
  NEON_AUTH_BASE_URL: z.url({ protocol: /^https$/ }),
  NEON_AUTH_COOKIE_SECRET: z.string().min(32),
})

const result = schema.safeParse(process.env)
if (!result.success) {
  // Zod inputs and driver errors can contain credentials; report names only.
  const names = [...new Set(result.error.issues.map((issue) => issue.path[0]))]
  throw new Error(
    `Invalid server environment: ${names.join(", ")}. NEON_AUTH_COOKIE_SECRET must contain at least 32 characters.`
  )
}

export const serverEnv = result.data
