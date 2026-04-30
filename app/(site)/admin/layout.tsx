import { redirect } from "next/navigation";

import { AdminNav } from "@/components/admin/admin-nav";
import { getCurrentUser, isAdmin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * Layout for `/admin/*`.
 *
 * Server component — performs an authoritative auth + role check via
 * `getCurrentUser()`. Unauthenticated visitors are redirected to
 * `/login?next=…` so they can sign in and come back; authenticated
 * non-admins are bounced home with no admin-only state ever rendered.
 *
 * Children receive a two-column shell on desktop with a sidebar nav and
 * the page content. On mobile the nav stacks above the content. The
 * structure mirrors `/account` so admins moving between the two
 * sections see a consistent shape.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/admin/products");
  }
  if (!isAdmin(user)) {
    // Authenticated but not an admin — send them home rather than
    // bouncing to /login (which would imply re-authenticating helps).
    redirect("/");
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <div className="mb-8 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage promotions, customers, and store configuration.
        </p>
      </div>
      <div className="grid gap-8 md:grid-cols-[220px_1fr]">
        <aside className="md:sticky md:top-20 md:self-start">
          <AdminNav />
        </aside>
        <section className="min-w-0 space-y-6">{children}</section>
      </div>
    </main>
  );
}
