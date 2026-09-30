import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ResumeUpload } from "@/components/resume-upload"
import { requireCurrentProfile } from "@/lib/auth/context"

export default async function ResumePage() {
  await requireCurrentProfile()

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
        <ResumeUpload />
      </CardContent>
    </Card>
  )
}
