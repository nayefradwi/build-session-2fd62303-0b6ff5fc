import type { Metadata } from "next";

import { SiteHeader } from "@/components/site/site-header";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Build Session",
  description: "Build session app.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <div className="flex min-h-screen flex-col">
          {/* Server component — re-renders on `router.refresh()` so the
              auth state stays in sync after login / logout. */}
          <SiteHeader />
          <div className="flex-1">{children}</div>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
