"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

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
import {
  addressFormSchema,
  emptyAddressFormValues,
  type AddressFormValues,
} from "@/lib/client/address-schema";
import type { Address } from "@/components/account/types";

interface AddressFormProps {
  /** Existing address when editing; absent when creating a new one. */
  initial?: Address;
  /**
   * Whether this submission will become the user's default address. The
   * default flag is mostly managed by parent UI (toggle/dedicated CTA),
   * but we honour it here so the form can also surface the option.
   */
  allowDefaultToggle?: boolean;
  /** Called with the validated values; the parent does the network IO. */
  onSubmit: (values: AddressFormValues) => Promise<void> | void;
  /** Called when the user dismisses the form without submitting. */
  onCancel: () => void;
  /** When true, the form ignores user input and shows a busy state. */
  pending?: boolean;
  /**
   * Server-side field errors to mirror inline. Map of field name → message.
   * The parent surfaces these from `fieldErrors` on the API response.
   */
  serverFieldErrors?: Partial<Record<keyof AddressFormValues, string>>;
}

/**
 * Address create/edit form. Renders the shared inputs and delegates the
 * actual fetch call back to the parent so list-level state (optimistic
 * updates, toast wording, default-flag promotion) lives in one place.
 */
export function AddressForm({
  initial,
  allowDefaultToggle = true,
  onSubmit,
  onCancel,
  pending = false,
  serverFieldErrors,
}: AddressFormProps) {
  const defaults: AddressFormValues = React.useMemo(() => {
    if (!initial) return emptyAddressFormValues;
    return {
      label: initial.label ?? "",
      recipient: initial.recipient ?? "",
      phone: initial.phone ?? "",
      line1: initial.line1,
      line2: initial.line2 ?? "",
      city: initial.city,
      state: initial.state ?? "",
      postalCode: initial.postalCode,
      country: initial.country,
      isDefault: initial.isDefault,
    };
  }, [initial]);

  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressFormSchema),
    mode: "onTouched",
    defaultValues: defaults,
  });

  React.useEffect(() => {
    form.reset(defaults);
  }, [defaults, form]);

  // Mirror server-side field errors back into the form whenever they
  // change so the user sees them next to the offending input.
  React.useEffect(() => {
    if (!serverFieldErrors) return;
    for (const [field, message] of Object.entries(serverFieldErrors) as [
      keyof AddressFormValues,
      string | undefined,
    ][]) {
      if (message) {
        form.setError(field, { type: "server", message });
      }
    }
  }, [form, serverFieldErrors]);

  const isSubmitting = pending || form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4"
        data-testid="address-form"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="label"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Label</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Home, Work, …"
                    disabled={isSubmitting}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="recipient"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Recipient</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Full name (if different)"
                    autoComplete="name"
                    disabled={isSubmitting}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  autoComplete="tel"
                  placeholder="Optional contact number"
                  disabled={isSubmitting}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="line1"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address line 1</FormLabel>
              <FormControl>
                <Input
                  autoComplete="address-line1"
                  placeholder="Street address"
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="line2"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address line 2</FormLabel>
              <FormControl>
                <Input
                  autoComplete="address-line2"
                  placeholder="Apartment, suite, unit (optional)"
                  disabled={isSubmitting}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="address-level2"
                    disabled={isSubmitting}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State / region</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="address-level1"
                    disabled={isSubmitting}
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="postalCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Postal code</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="postal-code"
                    disabled={isSubmitting}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="country"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="country"
                    placeholder="Two-letter ISO code (e.g. US)"
                    maxLength={2}
                    disabled={isSubmitting}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Two-letter ISO 3166-1 alpha-2 code.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {allowDefaultToggle && (
          <FormField
            control={form.control}
            name="isDefault"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start gap-3 space-y-0 rounded-md border p-3">
                <FormControl>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    checked={field.value === true}
                    disabled={isSubmitting || initial?.isDefault === true}
                    onChange={(e) => field.onChange(e.target.checked)}
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Use as default address</FormLabel>
                  <FormDescription>
                    {initial?.isDefault
                      ? "This is your default address."
                      : "We'll pre-select this address at checkout."}
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : initial ? (
              "Save address"
            ) : (
              "Add address"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
