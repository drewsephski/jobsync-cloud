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
            A home for your job search. Try it free for 14 days, then continue
            with Plus for $6/month.
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
          <Button
            variant="neutral"
            nativeButton={false}
            render={<Link href="/pricing" />}
          >
            See pricing
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}
