import type { PrismaClient } from "../../generated/prisma/client"
import { RESUME_STRUCTURE_KIND } from "./worker"
import { resumeSchema } from "../../ai/resume-schema"
export async function readResumeStructureStatus(
  db: PrismaClient,
  ownerUserId: string,
  uploadId: string
) {
  // Caller separately authorizes the upload; both queries remain owner-qualified.
  const [draft, run] = await Promise.all([
    db.resumeVersion.findFirst({
      where: { ownerUserId, sourceUploadId: uploadId },
      select: { id: true, version: true, status: true, data: true },
    }),
    db.processingRun.findFirst({
      where: { ownerUserId, resourceId: uploadId, kind: RESUME_STRUCTURE_KIND },
      select: { status: true, errorCode: true },
    }),
  ])
  if (draft)
    return {
      state: "draft" as const,
      message:
        "Structured draft ready. Review every fact against your original resume before using it.",
      draft: { ...draft, data: resumeSchema.parse(draft.data) },
    }
  if (run?.status === "failed" || run?.status === "canceled") {
    const code = run.errorCode
    const message =
      code === "no_extractable_text"
        ? "No readable text was found. Export a text-based PDF or DOCX; scanned documents are not supported yet."
        : code === "text_too_large"
          ? "This resume contains too much text. Upload a shorter resume."
          : code === "provider_outcome_unknown"
            ? "Processing stopped while confirming an AI request. Its usage requires reconciliation; requests without a provider receipt need operator review. No automatic paid retry will run."
            : code === "draft_commit_interrupted"
              ? "The AI request completed, but its draft could not be saved. Usage is recorded; no automatic paid retry will run."
              : code === "allowance_exhausted"
                ? "Your current resume-processing allowance is exhausted."
                : ["ai_paused", "ai_spend_limit"].includes(code ?? "")
                  ? "Resume structuring is temporarily paused."
                  : code === "invalid_model_output"
                    ? "The draft did not pass factual validation. Your original file remains available."
                    : "Resume structuring could not finish. Your original file remains available."
    return { state: "failed" as const, message, draft: null }
  }
  return {
    state: "processing" as const,
    message:
      "Structuring your resume into a draft for review. You can leave this page.",
    draft: null,
  }
}
