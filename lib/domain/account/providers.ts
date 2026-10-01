import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import Stripe from "stripe"
import {
  createStorageClient,
  STORAGE_BUCKET,
} from "../../backend/create-storage-client"
import type { AccountCleanup } from "./deletion"

export function accountCleanup(
  env: NodeJS.ProcessEnv = process.env
): AccountCleanup {
  return {
    async deleteFiles(owner) {
      if (!/^[a-zA-Z0-9_-]+$/.test(owner)) throw new Error("invalid_owner")
      const storage = createStorageClient({
        endpoint: env.AWS_ENDPOINT_URL_S3!,
        region: env.AWS_REGION!,
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      })
      try {
        const prefix = `users/${owner}/`
        // Always read the first page after removing it: continuation tokens can
        // become invalid when their objects have just been deleted.
        for (;;) {
          const page = await storage.send(
            new ListObjectsV2Command({
              Bucket: STORAGE_BUCKET,
              Prefix: prefix,
              MaxKeys: 1000,
            })
          )
          const objects = (page.Contents ?? [])
            .filter((o) => o.Key?.startsWith(prefix))
            .map((o) => ({ Key: o.Key! }))
          if (!objects.length) break
          const deleted = await storage.send(
            new DeleteObjectsCommand({
              Bucket: STORAGE_BUCKET,
              Delete: { Objects: objects, Quiet: true },
            })
          )
          if (deleted.Errors?.length) throw new Error("storage_delete_failed")
        }
      } finally {
        storage.destroy()
      }
    },
    async deleteBilling(customer) {
      const secret = customer.livemode
        ? (env.STRIPE_LIVE_CLEANUP_SECRET_KEY ??
          (env.STRIPE_MODE === "live" ? env.STRIPE_SECRET_KEY : undefined))
        : (env.STRIPE_TEST_CLEANUP_SECRET_KEY ??
          (env.STRIPE_MODE === "test" ? env.STRIPE_SECRET_KEY : undefined))
      if (!secret?.startsWith(customer.livemode ? "sk_live_" : "sk_test_"))
        throw new Error("cleanup_billing_mode_unavailable")
      const stripe = new Stripe(secret, {
        timeout: 10_000,
        maxNetworkRetries: 2,
      })
      let customerId = customer.stripeCustomerId
      if (!customerId) {
        // Rare provisioning recovery uses the authoritative listing, avoiding
        // Stripe Search's eventual-consistency window after a rolled-back save.
        const matches: Stripe.Customer[] = []
        for await (const candidate of stripe.customers.list({ limit: 100 })) {
          if (candidate.metadata.jobsync_billing_id === customer.id)
            matches.push(candidate)
        }
        if (matches.length > 1)
          throw new Error("cleanup_billing_provenance_ambiguous")
        customerId = matches[0]?.id ?? null
      }
      if (!customerId) return
      const remote = await stripe.customers.retrieve(customerId)
      if (remote.deleted) return
      if (
        remote.livemode !== customer.livemode ||
        remote.metadata.jobsync_billing_id !== customer.id ||
        remote.metadata.jobsync_owner !== customer.ownerUserId ||
        remote.metadata.jobsync_app !== "cloud"
      )
        throw new Error("cleanup_billing_provenance_mismatch")
      for await (const checkout of stripe.checkout.sessions.list({
        customer: customerId,
        status: "open",
        limit: 100,
      }))
        await stripe.checkout.sessions.expire(checkout.id)
      if (customer.checkoutSessionId) {
        const checkout = await stripe.checkout.sessions.retrieve(
          customer.checkoutSessionId
        )
        if (checkout.status === "open")
          await stripe.checkout.sessions.expire(checkout.id)
      }
      for await (const subscription of stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      })) {
        if (!["canceled", "incomplete_expired"].includes(subscription.status))
          await stripe.subscriptions.cancel(subscription.id, {
            invoice_now: false,
            prorate: false,
          })
      }
      await stripe.customers.del(customerId)
    },
    async deleteIdentity(owner) {
      if (
        !env.NEON_ACCOUNT_CLEANUP_API_KEY ||
        !env.NEON_ACCOUNT_CLEANUP_PROJECT_ID ||
        !env.NEON_ACCOUNT_CLEANUP_BRANCH_ID
      )
        throw new Error("auth_cleanup_not_configured")
      const parts = [
        env.NEON_ACCOUNT_CLEANUP_PROJECT_ID,
        env.NEON_ACCOUNT_CLEANUP_BRANCH_ID,
        owner,
      ].map(encodeURIComponent)
      const response = await fetch(
        `https://console.neon.tech/api/v2/projects/${parts[0]}/branches/${parts[1]}/auth/users/${parts[2]}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${env.NEON_ACCOUNT_CLEANUP_API_KEY}`,
          },
          signal: AbortSignal.timeout(15_000),
        }
      )
      if (response.status === 404) {
        // A wrong project/branch also returns 404. Never mistake that for an
        // already-removed user when recovering after an interrupted response.
        const branch = await fetch(
          `https://console.neon.tech/api/v2/projects/${parts[0]}/branches/${parts[1]}`,
          {
            headers: {
              Authorization: `Bearer ${env.NEON_ACCOUNT_CLEANUP_API_KEY}`,
            },
            signal: AbortSignal.timeout(15_000),
          }
        )
        if (
          !branch.ok ||
          (await branch.json()).branch?.id !==
            env.NEON_ACCOUNT_CLEANUP_BRANCH_ID
        )
          throw new Error("auth_cleanup_branch_unverified")
      } else if (!response.ok) throw new Error("auth_cleanup_unavailable")
    },
  }
}
