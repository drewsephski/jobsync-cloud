import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty"

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle role="heading" aria-level={1}>
            JobSync Cloud
          </EmptyTitle>
          <EmptyDescription>
            A home for your job search. Account setup is available now.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button nativeButton={false} render={<Link href="/auth/sign-up" />}>
            Create account
          </Button>
          <Button
            variant="neutral"
            nativeButton={false}
            render={<Link href="/auth/sign-in" />}
          >
            Sign in
          </Button>
          <Button
            variant="neutral"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            Dashboard
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}
