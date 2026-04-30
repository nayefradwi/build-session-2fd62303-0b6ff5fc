import { redirect } from "next/navigation";

import { AccountNav } from "@/components/account/account-nav";
import { getCurrentUser } from "@/lib/server/auth";

/**
 * Layout for `/account/*`.
 *
 * Server component — performs an authoritative auth check via
 * `getCurrentUser()`. The middleware already redirects unauthenticated
 * traffic to `/login?next=...` for any path under `/account`, but we
 * defence-in-depth here so server-side rendering never leaks an empty
 * page in the (unlikely) event the cookie is present but the session
 * row is gone.
 *
 * Children receive a two-column shell on desktop with a sidebar nav
 * (Profile / Addresses / Order history) and the page content. On
 * mobile the nav stacks above the content.
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/account");
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      <div className="mb-8 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Your account</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile, shipping addresses, and order history.
        </p>
      </div>
      <div className="grid gap-8 md:grid-cols-[220px_1fr]">
        <aside className="md:sticky md:top-20 md:self-start">
          <AccountNav />
        </aside>
        <section className="min-w-0 space-y-6">{children}</section>
      </div>
    </main>
  );
}
