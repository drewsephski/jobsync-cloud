import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="grid min-h-svh grid-cols-[min(100%,24rem)] place-content-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <Button
          variant="neutral"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Back to JobSync Cloud
        </Button>
        {children}
      </div>
    </main>
  )
}
