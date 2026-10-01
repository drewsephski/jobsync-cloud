import { billingAction } from "@/lib/billing/api"
export const runtime = "nodejs"
export async function POST(request: Request) {
  return billingAction(request, "checkout")
}
