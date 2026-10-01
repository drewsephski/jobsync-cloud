import "server-only"
import { z } from "zod"
export function supportContact() {
  const email = z.email().safeParse(process.env.SUPPORT_EMAIL)
  return {
    email: email.success ? email.data : null,
    operator: process.env.OPERATOR_NAME?.trim() || null,
  }
}
