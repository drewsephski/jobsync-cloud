"use server"

import { auth } from "@/lib/auth/server"
import { redirect } from "next/navigation"
import { z } from "zod"

const schema = z.object({
  email: z.email(),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(200),
})

export async function signUpWithEmail(
  _prevState: { error: string } | null,
  formData: FormData
) {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
  })
  if (!parsed.success) return { error: "Please enter valid account details." }

  try {
    const { error } = await auth.signUp.email(parsed.data)
    if (error)
      return {
        error:
          "Unable to create your account. Check your details and try again.",
      }
  } catch {
    return { error: "Authentication service unavailable. Please try again." }
  }
  redirect("/auth/verify")
}
