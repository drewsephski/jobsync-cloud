"use client"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn(
        "w-full min-w-0 data-[orientation=vertical]:flex data-[orientation=vertical]:gap-4",
        className
      )}
      {...props}
    />
  )
}
const tabsListVariants = cva(
  "relative isolate flex w-fit max-w-full items-center gap-1 overflow-x-auto text-foreground data-[orientation=vertical]:flex-col",
  {
    variants: {
      variant: {
        default: "rounded-base bg-foreground/5 p-1",
        line: "border-b border-border bg-transparent p-1",
      },
    },
    defaultVariants: { variant: "default" },
  }
)
function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator className="tabs-indicator pointer-events-none absolute -z-10 rounded-lg bg-[var(--tab-active)] shadow-sm" />
    </TabsPrimitive.List>
  )
}
function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-foreground/65 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 data-active:text-foreground [&_svg]:size-4",
        className
      )}
      {...props}
    />
  )
}
function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(
        "mt-5 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring data-[orientation=vertical]:flex-1",
        className
      )}
      {...props}
    />
  )
}
export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
