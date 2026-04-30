import { redirect } from "next/navigation";

/**
 * `/admin` is currently a single-section dashboard — point it directly
 * at the discounts list. As more admin sections land we can swap this
 * out for a real overview page.
 */
export default function AdminIndexPage() {
  redirect("/admin/discounts");
}
