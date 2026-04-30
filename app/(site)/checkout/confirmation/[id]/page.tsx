import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LegacyCheckoutConfirmationPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Legacy redirect: `/checkout/confirmation/{id}` → `/orders/{id}/confirmation`.
 *
 * The canonical post-checkout thank-you page lives under `/orders/[id]/
 * confirmation`. This route used to host that view directly; we keep
 * the path alive as a permanent redirect so any bookmarks, transactional
 * emails, or stale browser history land on the new URL instead of a 404.
 */
export default async function LegacyCheckoutConfirmationPage({
  params,
}: LegacyCheckoutConfirmationPageProps) {
  const { id } = await params;
  if (!id || !UUID_RE.test(id)) notFound();
  redirect(`/orders/${id}/confirmation`);
}
