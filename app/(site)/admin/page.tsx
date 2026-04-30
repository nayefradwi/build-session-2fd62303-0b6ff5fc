import { redirect } from "next/navigation";

/**
 * `/admin` is currently a multi-section dashboard. Land admins on the
 * products surface (the busiest day-to-day workflow). As more admin
 * sections land we can swap this out for a real overview page.
 */
export default function AdminIndexPage() {
  redirect("/admin/products");
}
