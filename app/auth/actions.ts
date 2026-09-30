"use server"

import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/server"

export async function signOut() {
  try {
    const { error } = await auth.signOut()
    if (error) throw new Error("Sign out failed")
  } catch {
    throw new Error("Unable to sign out. Please try again.")
  }
  redirect("/auth/sign-in")
}
