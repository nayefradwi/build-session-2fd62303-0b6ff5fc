"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  ShieldX,
  Truck,
  X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { OrderStatusBadge } from "@/components/account/order-status-badge";
import {
  ADMIN_CANCELLABLE_STATUSES,
  ADMIN_FORWARD_TRANSITIONS,
  type AdminOrderApiError,
  type AdminOrderDetail,
  type AdminOrderListEntry,
  type AdminOrderStatus,
} from "@/components/admin/orders-types";
import { cn } from "@/lib/client/utils";
import { formatPrice } from "@/lib/client/format";

const REASON_MAX = 1000;

interface OrderDetailDrawerProps {
  /** When non-null the drawer is open and tries to load this order. */
  orderId: string | null;
  onClose: () => void;
  /**
   * Called whenever a write succeeds (status change / cancel) so the
   * parent list can patch its cached row in place.
   */
  onUpdated?: (entry: AdminOrderListEntry) => void;
}

interface DrawerState {
  loading: boolean;
  detail: AdminOrderDetail | null;
  error: string | null;
}

/**
 * A wide right-edge drawer that shows the full admin order detail. Built
 * on top of the existing shadcn Dialog primitive (which itself wraps
 * `@radix-ui/react-dialog`) but with a custom slide-from-right
 * `DialogContent` so the page underneath stays partially visible — the
 * triage workflow keeps moving from the list to a single order and back.
 *
 * Owns:
 *   - GET `/api/admin/orders/{id}` on open
 *   - PATCH `/api/admin/orders/{id}/status` for forward transitions
 *   - POST `/api/admin/orders/{id}/cancel` (with a required reason modal)
 */
export function OrderDetailDrawer({
  orderId,
  onClose,
  onUpdated,
}: OrderDetailDrawerProps) {
  const router = useRouter();
  const [state, setState] = React.useState<DrawerState>({
    loading: false,
    detail: null,
    error: null,
  });
  const [actionStatus, setActionStatus] =
    React.useState<AdminOrderStatus | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const open = orderId !== null;

  /* ------------------------------------------------------------------ */
  /* Load                                                               */
  /* ------------------------------------------------------------------ */

  const load = React.useCallback(
    async (id: string) => {
      setState({ loading: true, detail: null, error: null });
      try {
        const res = await fetch(`/api/admin/orders/${id}`, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/login?next=/admin/orders");
            return;
          }
          if (res.status === 403) {
            setState({
              loading: false,
              detail: null,
              error: "You don't have permission to view this order.",
            });
            return;
          }
          if (res.status === 404) {
            setState({
              loading: false,
              detail: null,
              error: "Order not found. It may have been deleted.",
            });
            return;
          }
          const body = await readApiError(res);
          setState({
            loading: false,
            detail: null,
            error: body?.error ?? "Failed to load order",
          });
          return;
        }
        const json = (await res.json()) as { order: AdminOrderDetail };
        setState({ loading: false, detail: json.order, error: null });
      } catch (err) {
        setState({
          loading: false,
          detail: null,
          error: err instanceof Error ? err.message : "Network error",
        });
      }
    },
    [router],
  );

  React.useEffect(() => {
    if (orderId) {
      void load(orderId);
    } else {
      setState({ loading: false, detail: null, error: null });
      setCancelOpen(false);
      setActionStatus(null);
    }
  }, [orderId, load]);

  /* ------------------------------------------------------------------ */
  /* Status transitions                                                 */
  /* ------------------------------------------------------------------ */

  const transition = async (to: AdminOrderStatus) => {
    if (!state.detail) return;
    setActionStatus(to);
    try {
      const res = await fetch(`/api/admin/orders/${state.detail.id}/status`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      if (!res.ok) {
        const body = await readApiError(res);
        if (res.status === 409 && body?.code === "stale_status") {
          toast.error("Status changed", {
            description:
              "Another admin moved this order. Re-reading the latest state.",
          });
          await load(state.detail.id);
          return;
        }
        if (res.status === 409 && body?.code === "invalid_transition") {
          toast.error("Transition not allowed", {
            description: body.error,
          });
          return;
        }
        toast.error("Couldn't update status", {
          description:
            body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }
      const json = (await res.json()) as { order: AdminOrderDetail };
      setState({ loading: false, detail: json.order, error: null });
      toast.success(`Order moved to ${labelFor(json.order.status)}`);
      onUpdated?.(json.order);
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setActionStatus(null);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Cancel modal                                                       */
  /* ------------------------------------------------------------------ */

  const onCancelled = (next: AdminOrderDetail) => {
    setState({ loading: false, detail: next, error: null });
    onUpdated?.(next);
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-2xl flex-col gap-0 border-l bg-background shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
            "duration-200",
          )}
          data-testid="admin-order-drawer"
        >
          <DialogPrimitive.Title className="sr-only">
            {state.detail
              ? `Order ${state.detail.orderNumber}`
              : "Order details"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Manage the selected order, transition fulfilment status, or
            cancel with a reason.
          </DialogPrimitive.Description>

          <header className="flex items-center justify-between border-b px-6 py-4">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Order
              </p>
              <p className="font-mono text-base font-semibold">
                {state.detail?.orderNumber ?? "—"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {state.detail && (
                <OrderStatusBadge status={state.detail.status} />
              )}
              <DialogPrimitive.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            {state.loading ? (
              <div
                className="flex items-center gap-2 text-sm text-muted-foreground"
                data-testid="admin-order-drawer-loading"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading order…
              </div>
            ) : state.error ? (
              <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {state.error}
                </div>
                {orderId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void load(orderId)}
                  >
                    Try again
                  </Button>
                )}
              </div>
            ) : state.detail ? (
              <OrderDetailBody detail={state.detail} />
            ) : null}
          </div>

          {state.detail && (
            <footer className="space-y-3 border-t bg-muted/20 px-6 py-4">
              <ActionBar
                detail={state.detail}
                actionStatus={actionStatus}
                onTransition={(to) => void transition(to)}
                onCancelClick={() => setCancelOpen(true)}
              />
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      {state.detail && (
        <CancelOrderModal
          open={cancelOpen}
          orderId={state.detail.id}
          onClose={() => setCancelOpen(false)}
          onCancelled={(next) => {
            setCancelOpen(false);
            onCancelled(next);
          }}
        />
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------- */
/* Body                                                                 */
/* -------------------------------------------------------------------- */

function OrderDetailBody({ detail }: { detail: AdminOrderDetail }) {
  return (
    <div className="space-y-6" data-testid="admin-order-detail">
      <Section title="Customer">
        <div className="space-y-1 text-sm">
          <div className="font-medium">
            {detail.customer.name ??
              detail.shippingAddress.recipient ??
              "(unnamed customer)"}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{detail.customer.email}</span>
          </div>
          {detail.shippingAddress.phone && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{detail.shippingAddress.phone}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Placed {formatDateTime(detail.createdAt)}
          </p>
          {detail.updatedAt !== detail.createdAt && (
            <p className="text-xs text-muted-foreground">
              Updated {formatDateTime(detail.updatedAt)}
            </p>
          )}
        </div>
      </Section>

      <Section title="Shipping">
        <div className="space-y-1 text-sm">
          {detail.shippingAddress.recipient && (
            <div className="font-medium">{detail.shippingAddress.recipient}</div>
          )}
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin
              className="mt-0.5 h-3.5 w-3.5 flex-none"
              aria-hidden="true"
            />
            <div>
              <div>{detail.shippingAddress.line1}</div>
              {detail.shippingAddress.line2 && (
                <div>{detail.shippingAddress.line2}</div>
              )}
              <div>
                {detail.shippingAddress.city}
                {detail.shippingAddress.state
                  ? `, ${detail.shippingAddress.state}`
                  : ""}{" "}
                {detail.shippingAddress.postalCode}
              </div>
              <div>{detail.shippingAddress.country}</div>
            </div>
          </div>
        </div>
      </Section>

      <Section title={`Items (${detail.items.length})`}>
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 text-right font-medium">Line</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {detail.items.map((item) => (
                <tr key={item.id} data-testid={`admin-order-item-${item.id}`}>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-start gap-3">
                      <div className="relative h-12 w-12 flex-none overflow-hidden rounded border bg-muted">
                        {item.imageUrl ? (
                          <Image
                            src={item.imageUrl}
                            alt=""
                            fill
                            sizes="48px"
                            className="object-cover"
                            unoptimized
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wide text-muted-foreground">
                            No image
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[item.size, item.material, item.color]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-xs">
                    {item.sku}
                  </td>
                  <td className="px-3 py-2 align-top">{item.quantity}</td>
                  <td className="px-3 py-2 align-top whitespace-nowrap">
                    {formatPrice(item.unitPriceCents, item.currency)}
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap text-right font-medium">
                    {formatPrice(item.lineTotalCents, item.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Totals">
        <dl className="space-y-1 text-sm">
          <Total label="Subtotal" value={detail.subtotalCents} currency={detail.currency} />
          <Total label="Shipping" value={detail.shippingCents} currency={detail.currency} />
          {detail.discountCents > 0 && (
            <Total
              label={
                detail.discountCode
                  ? `Discount (${detail.discountCode})`
                  : "Discount"
              }
              value={-Math.abs(detail.discountCents)}
              currency={detail.currency}
              accent="discount"
            />
          )}
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-base font-semibold">
            <span>Total</span>
            <span data-testid="admin-order-total">
              {formatPrice(detail.totalCents, detail.currency)}
            </span>
          </div>
        </dl>
      </Section>

      {detail.notes && (
        <Section title="Customer notes">
          <p className="text-sm text-muted-foreground">{detail.notes}</p>
        </Section>
      )}

      {detail.cancellation && (
        <Section title="Cancellation">
          <div
            className="space-y-1 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm dark:border-rose-900/50 dark:bg-rose-950/30"
            data-testid="admin-order-cancellation"
          >
            <div className="flex items-center gap-2 font-medium text-rose-900 dark:text-rose-200">
              <ShieldX className="h-4 w-4" aria-hidden="true" />
              <span>Order cancelled</span>
            </div>
            {detail.cancellation.cancelledAt && (
              <p className="text-xs text-rose-900/80 dark:text-rose-200/80">
                {formatDateTime(detail.cancellation.cancelledAt)}
              </p>
            )}
            {detail.cancellation.reason && (
              <p className="whitespace-pre-line text-sm text-rose-900 dark:text-rose-100">
                {detail.cancellation.reason}
              </p>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Total({
  label,
  value,
  currency,
  accent,
}: {
  label: string;
  value: number;
  currency: string;
  accent?: "discount";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-sm",
        accent === "discount" ? "text-emerald-700 dark:text-emerald-300" : "",
      )}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{formatPrice(value, currency)}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Action bar                                                           */
/* -------------------------------------------------------------------- */

function ActionBar({
  detail,
  actionStatus,
  onTransition,
  onCancelClick,
}: {
  detail: AdminOrderDetail;
  actionStatus: AdminOrderStatus | null;
  onTransition: (to: AdminOrderStatus) => void;
  onCancelClick: () => void;
}) {
  const allowed = ADMIN_FORWARD_TRANSITIONS[detail.status] ?? [];
  const cancellable = (
    ADMIN_CANCELLABLE_STATUSES as ReadonlyArray<string>
  ).includes(detail.status);

  if (allowed.length === 0 && !cancellable) {
    return (
      <p className="text-xs text-muted-foreground">
        This order is in a terminal state. No further actions are
        available.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {allowed.map((next) => {
          const Icon = iconFor(next);
          const busy = actionStatus === next;
          return (
            <Button
              key={next}
              type="button"
              size="sm"
              onClick={() => onTransition(next)}
              disabled={actionStatus !== null}
              data-testid={`admin-order-transition-${next}`}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Icon className="h-4 w-4" aria-hidden="true" />
              )}
              Mark as {labelFor(next)}
            </Button>
          );
        })}
      </div>
      {cancellable && (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={onCancelClick}
          disabled={actionStatus !== null}
          data-testid="admin-order-cancel-trigger"
        >
          <ShieldX className="h-4 w-4" aria-hidden="true" />
          Cancel order
        </Button>
      )}
    </div>
  );
}

function iconFor(status: AdminOrderStatus) {
  switch (status) {
    case "shipped":
      return Truck;
    case "delivered":
      return CheckCircle2;
    case "processing":
    case "paid":
    case "pending":
    case "cancelled":
    default:
      return CheckCircle2;
  }
}

function labelFor(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "paid":
      return "Paid";
    case "processing":
      return "Processing";
    case "shipped":
      return "Shipped";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/* -------------------------------------------------------------------- */
/* Cancel modal                                                         */
/* -------------------------------------------------------------------- */

function CancelOrderModal({
  open,
  orderId,
  onClose,
  onCancelled,
}: {
  open: boolean;
  orderId: string;
  onClose: () => void;
  onCancelled: (detail: AdminOrderDetail) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setReason("");
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      toast.error("Reason is required", {
        description:
          "Customers and ops both rely on the cancellation reason.",
      });
      return;
    }
    if (trimmed.length > REASON_MAX) {
      toast.error("Reason is too long", {
        description: `Keep it under ${REASON_MAX} characters.`,
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/cancel`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: trimmed }),
      });
      if (!res.ok) {
        const body = await readApiError(res);
        if (res.status === 409 && body?.code === "not_cancellable") {
          toast.error("Order can't be cancelled", {
            description: body.error,
          });
          return;
        }
        if (res.status === 409 && body?.code === "stale_status") {
          toast.error("Status changed", {
            description:
              "Another admin moved this order. Refresh to see the latest state.",
          });
          return;
        }
        toast.error("Couldn't cancel order", {
          description:
            body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }
      const json = (await res.json()) as { order: AdminOrderDetail };
      toast.success("Order cancelled");
      onCancelled(json.order);
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const remaining = REASON_MAX - reason.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
    >
      <DialogContent className="max-w-md" data-testid="admin-order-cancel-modal">
        <DialogHeader>
          <DialogTitle>Cancel this order?</DialogTitle>
          <DialogDescription>
            The reason is captured on the order and shared with the
            customer. This can&apos;t be undone — cancelled orders cannot
            be re-opened.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Reason</Label>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Out of stock, payment failed, customer request…"
            className="min-h-[7rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={REASON_MAX}
            disabled={submitting}
            data-testid="admin-order-cancel-reason"
          />
          <div className="flex justify-end text-xs text-muted-foreground">
            {remaining.toLocaleString()} characters left
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Keep order
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void submit()}
            disabled={submitting || reason.trim().length === 0}
            data-testid="admin-order-cancel-submit"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Cancelling…
              </>
            ) : (
              <>
                <ShieldX className="h-4 w-4" aria-hidden="true" />
                Cancel order
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------- */
/* Helpers                                                              */
/* -------------------------------------------------------------------- */

async function readApiError(
  res: Response,
): Promise<AdminOrderApiError | null> {
  try {
    return (await res.json()) as AdminOrderApiError;
  } catch {
    return null;
  }
}

function formatDateTime(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

