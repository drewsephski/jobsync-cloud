import "server-only"

import { z } from "zod"

declare const verifiedSession: unique symbol
export type CurrentAuthUser = Readonly<{
  id: string
  name: string | null
  email: string | null
  [verifiedSession]: true
}>

const userSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  email: z.email().nullish(),
})

// Internal dependency seam for testing the session boundary without a provider.
export function createSessionContext(
  readSession: () => Promise<{ data: unknown; error: unknown }>,
  redirectToSignIn: () => never
) {
  async function getCurrentAuthUser(): Promise<CurrentAuthUser | null> {
    let result: Awaited<ReturnType<typeof readSession>>
    try {
      result = await readSession()
    } catch {
      throw new Error("Authentication service unavailable")
    }
    if (result.error) throw new Error("Authentication service unavailable")
    if (result.data === null) return null
    const session = z.object({ user: userSchema }).safeParse(result.data)
    if (!session.success) throw new Error("Invalid authenticated session")
    const { id, name, email } = session.data.user
    // Only this verified-session boundary produces the branded identity.
    return { id, name: name ?? null, email: email ?? null } as CurrentAuthUser
  }

  async function requireCurrentAuthUser(): Promise<CurrentAuthUser> {
    const user = await getCurrentAuthUser()
    if (!user) return redirectToSignIn()
    return user
  }

  return { getCurrentAuthUser, requireCurrentAuthUser }
}
