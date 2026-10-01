import Link from "next/link"
import type { ComponentProps } from "react"
import type { VariantProps } from "class-variance-authority"
import { buttonVariants } from "./button"
import { cn } from "@/lib/utils"

export function LinkButton({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return (
    <Link
      data-slot="button"
      data-variant={variant ?? "default"}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
