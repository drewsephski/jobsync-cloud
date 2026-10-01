import { accountApi } from "@/lib/domain/account/api"
export const runtime = "nodejs"
export const PATCH = (request: Request) => accountApi(request, "profile")
export const DELETE = (request: Request) => accountApi(request, "delete")
