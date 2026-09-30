import "server-only"
import { createNeonAuth } from "@neondatabase/auth/next/server"
import { serverEnv } from "@/lib/server-env"

export const auth = createNeonAuth({
  baseUrl: serverEnv.NEON_AUTH_BASE_URL,
  cookies: {
    secret: serverEnv.NEON_AUTH_COOKIE_SECRET,
    // sessionDataTtl: 300, // optional session_data cache TTL in seconds (default: 300)
  },
  logLevel: "silent", // Provider diagnostics can contain sensitive response data.
})
