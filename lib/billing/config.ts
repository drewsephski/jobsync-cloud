import { z } from "zod"
export function billingConfig() {
  const parsed = z
    .object({
      STRIPE_MODE: z.enum(["test", "live"]),
      STRIPE_SECRET_KEY: z.string().min(1),
      STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
      STRIPE_PLUS_PRICE_ID: z.string().startsWith("price_"),
      STRIPE_PLUS_PRODUCT_ID: z.string().startsWith("prod_"),
      STRIPE_PORTAL_CONFIGURATION_ID: z.string().startsWith("bpc_").optional(),
      APP_ORIGIN: z.url().refine((v) => new URL(v).origin === v),
    })
    .safeParse(process.env)
  if (!parsed.success) throw new Error("billing_not_configured")
  const config = parsed.data
  if (
    !config.STRIPE_SECRET_KEY.startsWith(
      config.STRIPE_MODE === "test" ? "sk_test_" : "sk_live_"
    )
  )
    throw new Error("billing_mode_mismatch")
  return { ...config, livemode: config.STRIPE_MODE === "live" }
}
