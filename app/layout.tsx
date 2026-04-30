import type { Metadata } from "next";

import { SiteHeader } from "@/components/site/site-header";
import { Toaster } from "@/components/ui/sonner";
import { CartProvider } from "@/lib/client/cart-store";
import { WishlistProvider } from "@/lib/client/wishlist-store";
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
        {/* Cart + wishlist providers wrap the whole tree so product
            cards, the PDP and the header badge can share a single source
            of truth for "is this in my wishlist?" / "how many items in
            my cart?" without each surface refetching. */}
        <CartProvider>
          <WishlistProvider>
            <div className="flex min-h-screen flex-col">
              {/* Server component — re-renders on `router.refresh()` so
                  the auth state stays in sync after login / logout. The
                  header's cart badge is a child client component that
                  subscribes to the cart store directly, so it updates
                  instantly on add-to-cart without a server roundtrip. */}
              <SiteHeader />
              <div className="flex-1">{children}</div>
            </div>
          </WishlistProvider>
        </CartProvider>
        <Toaster />
      </body>
    </html>
  );
}
