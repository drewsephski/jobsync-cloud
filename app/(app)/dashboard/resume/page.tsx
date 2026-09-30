import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ResumeUpload } from "@/components/resume-upload"
import { db } from "@/lib/db"
import { requireCurrentProfile } from "@/lib/auth/context"

export default async function ResumePage() {
  const { user } = await requireCurrentProfile()
  const latest = await db.resumeUpload.findFirst({
    where: { ownerUserId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={1}>
          Resume file
        </CardTitle>
        <CardDescription>
          Upload a PDF or Word document to your private JobSync storage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResumeUpload initialUploadId={latest?.id} />
      </CardContent>
    </Card>
  )
}
