"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AddressForm } from "@/components/account/address-form";
import type { Address } from "@/components/account/types";
import {
  toAddressApiPayload,
  type AddressFormValues,
} from "@/lib/client/address-schema";

interface AddressesManagerProps {
  /** Initial server-rendered list. Re-synced after every mutation. */
  initialAddresses: Address[];
}

interface AddressApiSuccessOne {
  address: Address;
}

interface AddressApiSuccessList {
  addresses: Address[];
}

interface AddressApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

type EditorState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; id: string };

/**
 * Convert the server's `fieldErrors` into the per-field map the
 * `<AddressForm />` expects. Anything not on the form is dropped.
 */
function flattenServerErrors(
  fieldErrors: Record<string, string[]> | undefined,
): Partial<Record<keyof AddressFormValues, string>> {
  const result: Partial<Record<keyof AddressFormValues, string>> = {};
  if (!fieldErrors) return result;
  const known: ReadonlyArray<keyof AddressFormValues> = [
    "label",
    "recipient",
    "phone",
    "line1",
    "line2",
    "city",
    "state",
    "postalCode",
    "country",
    "isDefault",
  ];
  for (const key of known) {
    const message = fieldErrors[key]?.[0];
    if (message) result[key] = message;
  }
  return result;
}

/**
 * Format an address for compact display in the list. Nullable lines and
 * recipients are skipped so the cards don't render stray commas.
 */
function formatAddressLines(a: Address): string[] {
  const cityLine = [a.city, a.state, a.postalCode].filter(Boolean).join(", ");
  return [
    a.recipient ?? null,
    a.line1,
    a.line2,
    cityLine,
    a.country,
  ].filter((l): l is string => Boolean(l && l.length > 0));
}

/**
 * /account addresses manager. Owns the list state, the editor open/close
 * state, and the network IO for create/update/delete/set-default. The
 * API returns the canonical row on every mutation, so we always
 * re-render from the server's view of the world.
 *
 * After each mutation we also `router.refresh()` — that re-runs the
 * page's server component (and thus the addresses fetch) so a different
 * tab opening the page later sees the same list.
 */
export function AddressesManager({ initialAddresses }: AddressesManagerProps) {
  const router = useRouter();
  const [addresses, setAddresses] =
    React.useState<Address[]>(initialAddresses);
  const [editor, setEditor] = React.useState<EditorState>({ kind: "closed" });
  const [pending, setPending] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [serverErrors, setServerErrors] = React.useState<
    Partial<Record<keyof AddressFormValues, string>> | undefined
  >(undefined);

  // Re-sync if the parent ever passes a fresh server snapshot in
  // (e.g. after a router.refresh from sibling components).
  React.useEffect(() => {
    setAddresses(initialAddresses);
  }, [initialAddresses]);

  /**
   * Sort defaults first, then newest first, mirroring the server's
   * `listAddressesForUser` ordering. Used after optimistic mutations.
   */
  const sortAddresses = React.useCallback((rows: Address[]): Address[] => {
    return [...rows].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      const ba = new Date(b.createdAt).getTime();
      const aa = new Date(a.createdAt).getTime();
      return ba - aa;
    });
  }, []);

  const refreshFromServer = React.useCallback(async () => {
    try {
      const res = await fetch("/api/users/me/addresses", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as AddressApiSuccessList;
        setAddresses(sortAddresses(data.addresses));
      }
    } catch {
      // Refresh is best-effort; the post-mutation toast already fired.
    }
  }, [sortAddresses]);

  const handleApiError = (
    res: Response,
    body: AddressApiError | null,
    fallbackTitle: string,
  ): boolean => {
    if (res.status === 401) {
      toast.error("Session expired", {
        description: "Please sign in again to continue.",
      });
      router.replace("/login?next=/account");
      return true;
    }
    if (body?.fieldErrors) {
      setServerErrors(flattenServerErrors(body.fieldErrors));
    }
    toast.error(fallbackTitle, {
      description: body?.error ?? "Something went wrong. Please try again.",
    });
    return false;
  };

  const handleCreate = async (values: AddressFormValues) => {
    setPending(true);
    setServerErrors(undefined);
    try {
      const res = await fetch("/api/users/me/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(toAddressApiPayload(values)),
      });
      if (!res.ok) {
        let body: AddressApiError | null = null;
        try {
          body = (await res.json()) as AddressApiError;
        } catch {
          // not JSON
        }
        handleApiError(res, body, "Couldn't add address");
        return;
      }
      const data = (await res.json()) as AddressApiSuccessOne;
      // The server may have promoted the new row to default, demoting
      // an existing default. Easiest way to stay consistent is to refetch.
      await refreshFromServer();
      // Fall back to the optimistic insert if the refetch silently failed.
      setAddresses((prev) =>
        prev.some((a) => a.id === data.address.id)
          ? prev
          : sortAddresses([data.address, ...prev]),
      );
      toast.success("Address added", {
        description: data.address.isDefault
          ? "Saved and set as your default address."
          : "Saved to your address book.",
      });
      setEditor({ kind: "closed" });
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setPending(false);
    }
  };

  const handleUpdate = async (id: string, values: AddressFormValues) => {
    setPending(true);
    setServerErrors(undefined);
    try {
      const res = await fetch(`/api/users/me/addresses/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(toAddressApiPayload(values)),
      });
      if (!res.ok) {
        let body: AddressApiError | null = null;
        try {
          body = (await res.json()) as AddressApiError;
        } catch {
          // not JSON
        }
        handleApiError(res, body, "Couldn't update address");
        return;
      }
      const data = (await res.json()) as AddressApiSuccessOne;
      await refreshFromServer();
      setAddresses((prev) =>
        sortAddresses(
          prev.some((a) => a.id === data.address.id)
            ? prev.map((a) => (a.id === data.address.id ? data.address : a))
            : [data.address, ...prev],
        ),
      );
      toast.success("Address updated", {
        description: "Your changes have been saved.",
      });
      setEditor({ kind: "closed" });
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        "Delete this address? This can't be undone.",
      )
    ) {
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/users/me/addresses/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        let body: AddressApiError | null = null;
        try {
          body = (await res.json()) as AddressApiError;
        } catch {
          // not JSON
        }
        handleApiError(res, body, "Couldn't delete address");
        return;
      }
      // The server may auto-promote a remaining row to default; refetch
      // so we don't have to reconstruct that logic on the client.
      await refreshFromServer();
      setAddresses((prev) => prev.filter((a) => a.id !== id));
      toast.success("Address deleted");
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleSetDefault = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/users/me/addresses/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        let body: AddressApiError | null = null;
        try {
          body = (await res.json()) as AddressApiError;
        } catch {
          // not JSON
        }
        handleApiError(res, body, "Couldn't set default address");
        return;
      }
      await refreshFromServer();
      // Optimistic: bump the chosen row to default and demote others.
      setAddresses((prev) =>
        sortAddresses(
          prev.map((a) => ({ ...a, isDefault: a.id === id })),
        ),
      );
      toast.success("Default address updated");
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const isEmpty = addresses.length === 0;
  const editingAddress =
    editor.kind === "edit"
      ? addresses.find((a) => a.id === editor.id)
      : undefined;

  return (
    <Card data-testid="addresses-manager">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="text-xl">Addresses</CardTitle>
          <CardDescription>
            Manage the addresses you ship to. Your default is pre-selected
            at checkout.
          </CardDescription>
        </div>
        {editor.kind === "closed" && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setServerErrors(undefined);
              setEditor({ kind: "create" });
            }}
          >
            <Plus className="h-4 w-4" />
            Add address
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {editor.kind === "create" && (
          <div className="rounded-lg border bg-muted/40 p-4">
            <h3 className="mb-3 text-sm font-semibold">New address</h3>
            <AddressForm
              onSubmit={handleCreate}
              onCancel={() => {
                setEditor({ kind: "closed" });
                setServerErrors(undefined);
              }}
              pending={pending}
              serverFieldErrors={serverErrors}
              allowDefaultToggle={!isEmpty}
            />
          </div>
        )}

        {editor.kind === "edit" && editingAddress && (
          <div className="rounded-lg border bg-muted/40 p-4">
            <h3 className="mb-3 text-sm font-semibold">Edit address</h3>
            <AddressForm
              initial={editingAddress}
              onSubmit={(values) => handleUpdate(editingAddress.id, values)}
              onCancel={() => {
                setEditor({ kind: "closed" });
                setServerErrors(undefined);
              }}
              pending={pending}
              serverFieldErrors={serverErrors}
            />
          </div>
        )}

        {isEmpty && editor.kind === "closed" ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            <MapPin
              className="mb-2 h-8 w-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">No addresses yet</p>
            <p className="mb-4 text-sm text-muted-foreground">
              Add an address to speed up checkout.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setServerErrors(undefined);
                setEditor({ kind: "create" });
              }}
            >
              <Plus className="h-4 w-4" />
              Add your first address
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {addresses.map((address) => {
              const isBusy = busyId === address.id;
              const lines = formatAddressLines(address);
              return (
                <li
                  key={address.id}
                  className="rounded-lg border bg-card p-4"
                  data-testid={`address-${address.id}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {address.label ?? "Address"}
                        </span>
                        {address.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            <Star
                              className="h-3 w-3"
                              aria-hidden="true"
                              fill="currentColor"
                            />
                            Default
                          </span>
                        )}
                      </div>
                      <address className="space-y-0.5 text-sm not-italic text-muted-foreground">
                        {lines.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                        {address.phone && (
                          <div className="pt-1">{address.phone}</div>
                        )}
                      </address>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:justify-end">
                      {!address.isDefault && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetDefault(address.id)}
                          disabled={isBusy || pending}
                        >
                          {isBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Star className="h-4 w-4" />
                          )}
                          Set default
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setServerErrors(undefined);
                          setEditor({ kind: "edit", id: address.id });
                        }}
                        disabled={isBusy || pending}
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(address.id)}
                        disabled={isBusy || pending}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Delete address"
                      >
                        {isBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
