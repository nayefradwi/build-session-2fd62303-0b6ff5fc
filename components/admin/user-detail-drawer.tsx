"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Loader2,
  Mail,
  MapPin,
  Phone,
  ShieldBan,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { UserStatusBadge } from "@/components/admin/user-status-badge";
import {
  type AdminUserApiError,
  type AdminUserDetail,
} from "@/components/admin/users-types";
import { cn } from "@/lib/client/utils";
import { formatPrice } from "@/lib/client/format";

const REASON_MAX = 1000;

interface UserDetailDrawerProps {
  /** When non-null the drawer is open and tries to load this user. */
  userId: string | null;
  /** Acting admin's id — controls self-action protections. */
  actorUserId: string | null;
  onClose: () => void;
  /**
   * Called whenever a write succeeds (enable / disable) so the parent
   * list can patch its cached row in place.
   */
  onUpdated?: (entry: AdminUserDetail) => void;
}

interface DrawerState {
  loading: boolean;
  detail: AdminUserDetail | null;
  error: string | null;
}

/**
 * A wide right-edge drawer that shows the full admin user detail.
 *
 * Owns:
 *   - GET `/api/admin/users/{id}` on open
 *   - POST `/api/admin/users/{id}/disable` (with confirmation + reason)
 *   - POST `/api/admin/users/{id}/enable` (with confirmation)
 *
 * The acting admin's id is forwarded so we can grey out the toggle on
 * the admin's own row — the API returns 409 self_action there too, but
 * surfacing the rule in the UI keeps the affordance honest.
 */
export function UserDetailDrawer({
  userId,
  actorUserId,
  onClose,
  onUpdated,
}: UserDetailDrawerProps) {
  const router = useRouter();
  const [state, setState] = React.useState<DrawerState>({
    loading: false,
    detail: null,
    error: null,
  });
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const open = userId !== null;

  /* ------------------------------------------------------------------ */
  /* Load                                                               */
  /* ------------------------------------------------------------------ */

  const load = React.useCallback(
    async (id: string) => {
      setState({ loading: true, detail: null, error: null });
      try {
        const res = await fetch(`/api/admin/users/${id}`, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/login?next=/admin/users");
            return;
          }
          if (res.status === 403) {
            setState({
              loading: false,
              detail: null,
              error: "You don't have permission to view this user.",
            });
            return;
          }
          if (res.status === 404) {
            setState({
              loading: false,
              detail: null,
              error: "User not found. They may have been deleted.",
            });
            return;
          }
          const body = await readApiError(res);
          setState({
            loading: false,
            detail: null,
            error: body?.error ?? "Failed to load user",
          });
          return;
        }
        const json = (await res.json()) as { user: AdminUserDetail };
        setState({ loading: false, detail: json.user, error: null });
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
    if (userId) {
      void load(userId);
    } else {
      setState({ loading: false, detail: null, error: null });
      setConfirmOpen(false);
    }
  }, [userId, load]);

  const onToggled = (next: AdminUserDetail) => {
    setState({ loading: false, detail: next, error: null });
    onUpdated?.(next);
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                             */
  /* ------------------------------------------------------------------ */

  const isSelf =
    state.detail !== null &&
    actorUserId !== null &&
    state.detail.id === actorUserId;

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
          data-testid="admin-user-drawer"
        >
          <DialogPrimitive.Title className="sr-only">
            {state.detail
              ? `User ${state.detail.email}`
              : "User details"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Inspect this user&apos;s profile, addresses, and order
            history. Toggle account status from the action bar.
          </DialogPrimitive.Description>

          <header className="flex items-center justify-between border-b px-6 py-4">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                User
              </p>
              <p className="text-base font-semibold">
                {state.detail?.name ??
                  state.detail?.email ??
                  "—"}
              </p>
              {state.detail && state.detail.name && (
                <p className="text-xs text-muted-foreground">
                  {state.detail.email}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {state.detail && (
                <UserStatusBadge status={state.detail.status} />
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
                data-testid="admin-user-drawer-loading"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading user…
              </div>
            ) : state.error ? (
              <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  {state.error}
                </div>
                {userId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void load(userId)}
                  >
                    Try again
                  </Button>
                )}
              </div>
            ) : state.detail ? (
              <UserDetailBody detail={state.detail} isSelf={isSelf} />
            ) : null}
          </div>

          {state.detail && (
            <footer className="space-y-3 border-t bg-muted/20 px-6 py-4">
              {isSelf ? (
                <p className="text-xs text-muted-foreground">
                  You can&apos;t enable or disable your own account.
                </p>
              ) : (
                <ActionBar
                  detail={state.detail}
                  onToggleClick={() => setConfirmOpen(true)}
                />
              )}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      {state.detail && !isSelf && (
        <ToggleStatusModal
          open={confirmOpen}
          detail={state.detail}
          onClose={() => setConfirmOpen(false)}
          onToggled={(next) => {
            setConfirmOpen(false);
            onToggled(next);
          }}
        />
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------- */
/* Body                                                                 */
/* -------------------------------------------------------------------- */

function UserDetailBody({
  detail,
  isSelf,
}: {
  detail: AdminUserDetail;
  isSelf: boolean;
}) {
  return (
    <div className="space-y-6" data-testid="admin-user-detail">
      <Section title="Profile">
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {detail.name ?? "(no name on file)"}
            </span>
            {isSelf && <Badge variant="outline">You</Badge>}
            {detail.role === "admin" ? (
              <Badge variant="default" className="gap-1.5">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Admin
              </Badge>
            ) : (
              <Badge variant="secondary">Customer</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{detail.email}</span>
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            ID: {detail.id}
          </div>
          <p className="text-xs text-muted-foreground">
            Joined {formatDateTime(detail.createdAt)}
          </p>
          {detail.updatedAt !== detail.createdAt && (
            <p className="text-xs text-muted-foreground">
              Updated {formatDateTime(detail.updatedAt)}
            </p>
          )}
        </div>
      </Section>

      {detail.status === "disabled" && (
        <Section title="Account disabled">
          <div
            className="space-y-1 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm dark:border-rose-900/50 dark:bg-rose-950/30"
            data-testid="admin-user-disabled-banner"
          >
            <div className="flex items-center gap-2 font-medium text-rose-900 dark:text-rose-200">
              <ShieldBan className="h-4 w-4" aria-hidden="true" />
              <span>Login is currently blocked.</span>
            </div>
            {detail.disabledAt && (
              <p className="text-xs text-rose-900/80 dark:text-rose-200/80">
                Disabled {formatDateTime(detail.disabledAt)}
                {detail.disabledByUserId
                  ? ` by ${shortId(detail.disabledByUserId)}`
                  : ""}
              </p>
            )}
            {detail.disabledReason && (
              <p className="whitespace-pre-line text-sm text-rose-900 dark:text-rose-100">
                Reason: {detail.disabledReason}
              </p>
            )}
          </div>
        </Section>
      )}

      <Section title={`Addresses (${detail.addresses.length})`}>
        {detail.addresses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved addresses.
          </p>
        ) : (
          <ul className="space-y-3">
            {detail.addresses.map((a) => (
              <li
                key={a.id}
                className="rounded-md border bg-card p-3 text-sm"
                data-testid={`admin-user-address-${a.id}`}
              >
                <div className="mb-1 flex items-center gap-2">
                  {a.isDefault && (
                    <Badge variant="success" className="gap-1.5">
                      <Star className="h-3 w-3" aria-hidden="true" />
                      Default
                    </Badge>
                  )}
                  {a.label && (
                    <span className="text-xs font-medium">{a.label}</span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {a.recipient && (
                    <div className="font-medium">{a.recipient}</div>
                  )}
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <MapPin
                      className="mt-0.5 h-3.5 w-3.5 flex-none"
                      aria-hidden="true"
                    />
                    <div>
                      <div>{a.line1}</div>
                      {a.line2 && <div>{a.line2}</div>}
                      <div>
                        {a.city}
                        {a.state ? `, ${a.state}` : ""} {a.postalCode}
                      </div>
                      <div>{a.country}</div>
                    </div>
                  </div>
                  {a.phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{a.phone}</span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={`Orders (${detail.orderTotals.count.toLocaleString()})`}
      >
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <div>
            Lifetime spend:{" "}
            <span className="font-medium text-foreground">
              {formatPrice(
                detail.orderTotals.totalSpentCents,
                detail.orderTotals.currency ?? "USD",
              )}
            </span>
          </div>
        </div>
        {detail.orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This user hasn&apos;t placed any orders yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Placed</th>
                  <th className="px-3 py-2 font-medium">Items</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {detail.orders.map((o) => (
                  <tr
                    key={o.id}
                    data-testid={`admin-user-order-${o.id}`}
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="space-y-0.5">
                        <div className="font-mono text-xs font-semibold uppercase">
                          {o.orderNumber}
                        </div>
                        {o.discountCode && (
                          <div className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
                            {o.discountCode}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(o.createdAt)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {o.itemCount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap font-medium">
                      {formatPrice(o.totalCents, o.currency)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <Button
                        asChild
                        type="button"
                        variant="outline"
                        size="sm"
                      >
                        <Link
                          href={`/admin/orders?selected=${encodeURIComponent(o.id)}`}
                          data-testid={`admin-user-order-link-${o.id}`}
                        >
                          View
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
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

/* -------------------------------------------------------------------- */
/* Action bar                                                           */
/* -------------------------------------------------------------------- */

function ActionBar({
  detail,
  onToggleClick,
}: {
  detail: AdminUserDetail;
  onToggleClick: () => void;
}) {
  const isDisabled = detail.status === "disabled";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-muted-foreground">
        {isDisabled
          ? "This account is blocked from logging in."
          : "This account can sign in normally."}
      </div>
      {isDisabled ? (
        <Button
          type="button"
          size="sm"
          onClick={onToggleClick}
          data-testid="admin-user-enable-trigger"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Enable account
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={onToggleClick}
          data-testid="admin-user-disable-trigger"
        >
          <ShieldBan className="h-4 w-4" aria-hidden="true" />
          Disable account
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Toggle confirmation modal                                            */
/* -------------------------------------------------------------------- */

function ToggleStatusModal({
  open,
  detail,
  onClose,
  onToggled,
}: {
  open: boolean;
  detail: AdminUserDetail;
  onClose: () => void;
  onToggled: (next: AdminUserDetail) => void;
}) {
  const willDisable = detail.status === "active";
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setReason("");
      setSubmitting(false);
    }
  }, [open]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const url = willDisable
        ? `/api/admin/users/${detail.id}/disable`
        : `/api/admin/users/${detail.id}/enable`;
      const init: RequestInit = {
        method: "POST",
        credentials: "same-origin",
      };
      if (willDisable) {
        const trimmed = reason.trim();
        if (trimmed.length > REASON_MAX) {
          toast.error("Reason is too long", {
            description: `Keep it under ${REASON_MAX} characters.`,
          });
          setSubmitting(false);
          return;
        }
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify({
          reason: trimmed.length > 0 ? trimmed : null,
        });
      }
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = await readApiError(res);
        if (res.status === 409 && body?.code === "stale_status") {
          toast.error("Status changed", {
            description:
              "Another admin updated this user. Refresh to see the latest state.",
          });
          return;
        }
        if (res.status === 409 && body?.code === "self_action") {
          toast.error("Can't toggle your own account", {
            description: body.error,
          });
          return;
        }
        toast.error(
          willDisable ? "Couldn't disable user" : "Couldn't enable user",
          {
            description:
              body?.error ?? "Something went wrong. Please try again.",
          },
        );
        return;
      }
      const json = (await res.json()) as { user: AdminUserDetail };
      toast.success(
        willDisable
          ? "Account disabled"
          : "Account enabled",
      );
      onToggled(json.user);
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
      <DialogContent
        className="max-w-md"
        data-testid="admin-user-toggle-modal"
      >
        <DialogHeader>
          <DialogTitle>
            {willDisable
              ? "Disable this account?"
              : "Re-enable this account?"}
          </DialogTitle>
          <DialogDescription>
            {willDisable
              ? "Disabling will revoke every active session and refresh token immediately, so the user can no longer use a previously-issued cookie. They can be re-enabled later."
              : "The user will be able to sign in again. They will need to re-authenticate to obtain a fresh session — old sessions revoked at disable-time are not restored."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="font-medium">
              {detail.name ?? "(no name)"}
            </div>
            <div className="text-xs text-muted-foreground">{detail.email}</div>
          </div>
          {willDisable && (
            <div className="space-y-2">
              <Label htmlFor="disable-reason">
                Reason{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <textarea
                id="disable-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Fraud signal, customer request, account compromise…"
                className="min-h-[6rem] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                maxLength={REASON_MAX}
                disabled={submitting}
                data-testid="admin-user-disable-reason"
              />
              <div className="flex justify-end text-xs text-muted-foreground">
                {remaining.toLocaleString()} characters left
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Keep as is
          </Button>
          <Button
            type="button"
            variant={willDisable ? "destructive" : "default"}
            onClick={() => void submit()}
            disabled={submitting}
            data-testid="admin-user-toggle-submit"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {willDisable ? "Disabling…" : "Enabling…"}
              </>
            ) : willDisable ? (
              <>
                <ShieldBan className="h-4 w-4" aria-hidden="true" />
                Disable account
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Enable account
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
): Promise<AdminUserApiError | null> {
  try {
    return (await res.json()) as AdminUserApiError;
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

function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}
