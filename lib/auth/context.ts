import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/server"
import { createSessionContext } from "@/lib/auth/session-context"
import { ensureUserProfile } from "@/lib/auth/user-profile"

const context = createSessionContext(
  () => auth.getSession({ query: { disableCookieCache: "true" } }),
  () => redirect("/auth/sign-in")
)

// React cache is request-scoped, never shared between users/requests.
export const getCurrentAuthUser = cache(context.getCurrentAuthUser)
export const requireCurrentAuthUser = cache(context.requireCurrentAuthUser)
export const requireCurrentProfile = cache(async () => {
  const user = await requireCurrentAuthUser()
  const profile = await ensureUserProfile(user)
  return { user, profile }
})

export type { CurrentAuthUser } from "@/lib/auth/session-context"
