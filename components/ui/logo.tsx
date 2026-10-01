import Link from "next/link"
import Image from "next/image"
import { cn } from "@/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/jobsync-mark-cobalt.png"
      width={512}
      height={512}
      sizes="36px"
      alt=""
      aria-hidden="true"
      className={cn("size-9 shrink-0 rounded-[11px] shadow-sm", className)}
    />
  )
}

export function Logo({
  href = "/",
  className,
}: {
  href?: string
  className?: string
}) {
  return (
    <Link
      href={href}
      aria-label="JobSync Cloud"
      className={cn(
        "inline-flex shrink-0 items-center gap-2.5 rounded-sm text-lg font-semibold tracking-tight whitespace-nowrap",
        className
      )}
    >
      <LogoMark />
      <span className="flex flex-col gap-1 leading-none">
        <span>JobSync</span>
        <span className="text-xs font-medium tracking-[0.16em] text-foreground/65 uppercase">
          Cloud
        </span>
      </span>
    </Link>
  )
}
