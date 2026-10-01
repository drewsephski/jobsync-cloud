import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Suspense } from "react"
import { ProductAnalytics } from "@/components/ui/product-analytics"

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.APP_ORIGIN ?? "https://jobsync-cloud.vercel.app"
  ),
  title: { default: "JobSync Cloud", template: "%s | JobSync Cloud" },
  description: "Your job search workspace, already set up.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable} font-sans antialiased`}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <Suspense>
          <ProductAnalytics />
        </Suspense>
      </body>
    </html>
  )
}
