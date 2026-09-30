import { auth } from '@/lib/auth/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';

// Server components using auth methods must be rendered dynamically
export const dynamic = 'force-dynamic';

export default async function Home() {
  const { data: session } = await auth.getSession();

  if (session?.user) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Logged in</EmptyTitle>
          <EmptyDescription>Signed in as {session.user.name}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Not logged in</EmptyTitle>
        <EmptyDescription>Create an account or sign in to continue.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button nativeButton={false} render={<Link href="/auth/sign-up" />}>
          Sign up
        </Button>
        <Button variant="neutral" nativeButton={false} render={<Link href="/auth/sign-in" />}>
          Sign in
        </Button>
      </EmptyContent>
    </Empty>
  );
}
