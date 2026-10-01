import "server-only"
import Stripe from "stripe"
import { billingConfig } from "./config"
export function stripeClient() {
  return new Stripe(billingConfig().STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 10_000,
  })
}
