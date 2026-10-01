import { accountApi } from "@/lib/domain/account/api"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const GET = (request: Request) => accountApi(request, "export")
