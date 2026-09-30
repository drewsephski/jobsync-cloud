"use server"

import { auth } from "@/lib/auth/server"
import { redirect } from "next/navigation"
import { z } from "zod"

const schema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
})

export async function signInWithEmail(
  _prevState: { error: string } | null,
  formData: FormData
) {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  if (!parsed.success) return { error: "Please enter valid account details." }

  try {
    const { error } = await auth.signIn.email(parsed.data)
    if (error)
      return {
        error: "Unable to sign in. Check your credentials and try again.",
      }
  } catch {
    return { error: "Authentication service unavailable. Please try again." }
  }
  redirect("/dashboard")
}
