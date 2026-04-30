"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  AdminDiscountCode,
  AdminDiscountCodeApiError,
} from "@/components/admin/types";
import {
  centsToDollarsField,
  discountCodeFormSchema,
  isoToDatetimeLocalField,
  toDiscountCodeApiPayload,
  type DiscountCodeFormValues,
} from "@/lib/client/discount-code-schema";

interface DiscountCodeFormProps {
  /**
   * When provided we run in "edit" mode: the form is seeded with the
   * existing values and the submit hits PUT instead of POST. When
   * omitted we run in "create" mode.
   */
  initial?: AdminDiscountCode;
}

interface DiscountCodeApiSuccess {
  discountCode: AdminDiscountCode;
}

/**
 * Map the server's `fieldErrors` into the form's per-field error map.
 * Anything not on the form is dropped (the toast carries the gist).
 */
function flattenServerErrors(
  fieldErrors: Record<string, string[]> | undefined,
): Partial<Record<keyof DiscountCodeFormValues, string>> {
  const result: Partial<Record<keyof DiscountCodeFormValues, string>> = {};
  if (!fieldErrors) return result;
  const known: ReadonlyArray<keyof DiscountCodeFormValues> = [
    "code",
    "type",
    "value",
    "minOrderValue",
    "expiresAt",
    "usageLimit",
    "description",
    "isActive",
  ];
  for (const key of known) {
    const message = fieldErrors[key]?.[0];
    if (message) result[key] = message;
  }
  return result;
}

/**
 * Build the form's defaults. In create mode we start with sensible
 * blank values and `isActive=true`; in edit mode we mirror the existing
 * row, converting cents → dollars and ISO → datetime-local.
 */
function buildDefaults(
  initial: AdminDiscountCode | undefined,
): DiscountCodeFormValues {
  if (!initial) {
    return {
      code: "",
      type: "percentage",
      value: "",
      minOrderValue: "",
      expiresAt: "",
      usageLimit: "",
      description: "",
      isActive: true,
    };
  }
  return {
    code: initial.code,
    type: initial.type,
    value:
      initial.type === "percentage"
        ? String(initial.value)
        : centsToDollarsField(initial.value),
    minOrderValue: centsToDollarsField(initial.minOrderValue),
    expiresAt: isoToDatetimeLocalField(initial.expiresAt),
    usageLimit:
      initial.usageLimit == null ? "" : String(initial.usageLimit),
    description: initial.description ?? "",
    isActive: initial.isActive,
  };
}

/**
 * Admin create / edit form for a single discount code.
 *
 * Submits to:
 *   - `POST /api/admin/discount-codes` in create mode
 *   - `PUT  /api/admin/discount-codes/{id}` in edit mode
 *
 * Server-side `code_taken` (409) collisions are mapped into an inline
 * field error on `code`. Successful submits navigate back to
 * `/admin/discounts` and `router.refresh()` so the list reflects the
 * new state immediately.
 */
export function DiscountCodeForm({ initial }: DiscountCodeFormProps) {
  const router = useRouter();
  const isEdit = !!initial;

  const defaults = React.useMemo(() => buildDefaults(initial), [initial]);

  const form = useForm<DiscountCodeFormValues>({
    resolver: zodResolver(discountCodeFormSchema),
    mode: "onTouched",
    defaultValues: defaults,
  });

  React.useEffect(() => {
    form.reset(defaults);
  }, [form, defaults]);

  const type = form.watch("type");

  const onSubmit = async (values: DiscountCodeFormValues) => {
    const payload = toDiscountCodeApiPayload(values);
    const url = isEdit
      ? `/api/admin/discount-codes/${initial.id}`
      : "/api/admin/discount-codes";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let body: AdminDiscountCodeApiError | null = null;
        try {
          body = (await res.json()) as AdminDiscountCodeApiError;
        } catch {
          // not JSON
        }

        if (res.status === 401) {
          toast.error("Session expired", {
            description: "Please sign in again to continue.",
          });
          router.replace("/login?next=/admin/discounts");
          return;
        }
        if (res.status === 403) {
          toast.error("Admin access required", {
            description: "Your account doesn't have permission for this action.",
          });
          return;
        }
        if (res.status === 409 || body?.code === "code_taken") {
          form.setError("code", {
            type: "server",
            message: "A discount with that code already exists.",
          });
          toast.error("Code already in use", {
            description:
              "Choose a different code — that one is already taken.",
          });
          return;
        }

        if (body?.fieldErrors) {
          for (const [field, message] of Object.entries(
            flattenServerErrors(body.fieldErrors),
          )) {
            form.setError(field as keyof DiscountCodeFormValues, {
              type: "server",
              message,
            });
          }
        }

        toast.error(
          isEdit ? "Couldn't update discount" : "Couldn't create discount",
          {
            description: body?.error ?? "Something went wrong. Please try again.",
          },
        );
        return;
      }

      const data = (await res.json()) as DiscountCodeApiSuccess;
      toast.success(
        isEdit ? "Discount updated" : "Discount created",
        {
          description: `${data.discountCode.code} saved successfully.`,
        },
      );
      router.push("/admin/discounts");
      router.refresh();
    } catch (err) {
      toast.error("Network error", {
        description:
          err instanceof Error
            ? err.message
            : "Could not reach the server. Please try again.",
      });
    }
  };

  const isSubmitting = form.formState.isSubmitting;

  // Choose the value-field affordances based on the selected type so
  // admins type the right thing (a percent vs a dollar amount).
  const valueLabel = type === "percentage" ? "Percentage off" : "Amount off";
  const valuePlaceholder = type === "percentage" ? "10" : "5.00";
  const valueDescription =
    type === "percentage"
      ? "Whole percent between 1 and 100 (e.g. 10 means 10% off)."
      : "Dollar amount taken off the order subtotal (e.g. 5.00).";
  const valueInputMode = type === "percentage" ? "numeric" : "decimal";

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-5"
        data-testid="discount-code-form"
      >
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="SUMMER2026"
                  disabled={isSubmitting}
                  {...field}
                  onChange={(e) =>
                    field.onChange(e.target.value.toUpperCase())
                  }
                  data-testid="discount-code-input"
                />
              </FormControl>
              <FormDescription>
                3-64 characters. Letters, digits, dashes and underscores
                only — automatically upper-cased.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Discount type</FormLabel>
              <FormControl>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSubmitting}
                  {...field}
                  data-testid="discount-type-select"
                >
                  <option value="percentage">Percentage off</option>
                  <option value="fixed">Fixed amount off</option>
                </select>
              </FormControl>
              <FormDescription>
                Percent off the subtotal, or a flat dollar discount.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="value"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{valueLabel}</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  inputMode={valueInputMode}
                  autoComplete="off"
                  placeholder={valuePlaceholder}
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormDescription>{valueDescription}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="minOrderValue"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Minimum order (optional)</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="50.00"
                  disabled={isSubmitting}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormDescription>
                Cart subtotal must reach this amount for the code to
                apply. Leave blank for no minimum.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="expiresAt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Expires at (optional)</FormLabel>
              <FormControl>
                <Input
                  type="datetime-local"
                  disabled={isSubmitting}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormDescription>
                After this time the code automatically stops working.
                Leave blank for no expiry.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="usageLimit"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Usage limit (optional)</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="100"
                  disabled={isSubmitting}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormDescription>
                Maximum number of times this code can be redeemed across
                all customers. Leave blank for unlimited.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description (optional)</FormLabel>
              <FormControl>
                <textarea
                  rows={3}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Internal note — what's this code for?"
                  disabled={isSubmitting}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormDescription>
                Internal label shown only in the admin list. Customers
                never see this.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <FormControl>
                  <input
                    id="discount-active"
                    type="checkbox"
                    className="mt-1 h-4 w-4 cursor-pointer rounded border-input"
                    disabled={isSubmitting}
                    checked={field.value ?? true}
                    onChange={(e) => field.onChange(e.target.checked)}
                  />
                </FormControl>
                <div className="space-y-1">
                  <Label
                    htmlFor="discount-active"
                    className="cursor-pointer text-sm font-medium"
                  >
                    Active
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Inactive codes are rejected at checkout. Toggle off to
                    pause the code without deleting it.
                  </p>
                </div>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {isEdit && initial && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="font-medium">Usage</div>
            <p className="text-muted-foreground">
              Redeemed {initial.usageCount}{" "}
              {initial.usageCount === 1 ? "time" : "times"}
              {initial.usageLimit !== null
                ? ` of ${initial.usageLimit} allowed (${initial.usageRemaining ?? 0} remaining)`
                : " — no limit set"}
              .
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Create discount"
            )}
          </Button>
          <Button asChild type="button" variant="ghost">
            <Link href="/admin/discounts">Cancel</Link>
          </Button>
        </div>
      </form>
    </Form>
  );
}
