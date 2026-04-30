import { redirect } from "next/navigation";

/**
 * `/admin` is the section root. Land admins on the dashboard so they
 * see the headline metrics first; the per-surface workflows
 * (`/admin/products`, `/admin/orders`, …) live one click away in the
 * sidebar.
 */
export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}
