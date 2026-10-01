import { redirect } from "next/navigation"
import Link from "next/link"
import { requireCurrentProfile } from "@/lib/auth/context"
import { signOut } from "@/app/auth/actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

export default async function Dashboard() {
  // Pages and future operations authorize independently of layout/proxy reuse.
  const { user, profile } = await requireCurrentProfile()
  if (!profile.onboardingCompletedAt) redirect("/onboarding")
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={1}>
          JobSync Cloud
        </CardTitle>
        <CardDescription>
          Your resume is confirmed and your target roles are saved.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table aria-label="Your account">
          <TableBody>
            <TableRow>
              <TableHead scope="row">Name</TableHead>
              <TableCell>
                {profile.displayName ?? user.name ?? "Not set"}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableHead scope="row">Email</TableHead>
              <TableCell>{user.email ?? "Not set"}</TableCell>
            </TableRow>
            <TableRow>
              <TableHead scope="row">Onboarding</TableHead>
              <TableCell>
                {profile.onboardingCompletedAt ? "Complete" : "Not complete"}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter className="flex-wrap gap-3">
        <Button
          variant="neutral"
          nativeButton={false}
          render={<Link href="/dashboard/resume" />}
        >
          Review resume
        </Button>
        <form action={signOut}>
          <Button type="submit">Sign out</Button>
        </form>
      </CardFooter>
    </Card>
  )
}
