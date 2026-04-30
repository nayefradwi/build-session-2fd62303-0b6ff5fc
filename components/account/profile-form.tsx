"use client";

import * as React from "react";
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
import {
  profileFormSchema,
  type ProfileFormValues,
} from "@/lib/client/profile-schema";

export interface ProfileFormUser {
  id: string;
  email: string;
  name: string | null;
}

interface ProfileFormProps {
  user: ProfileFormUser;
}

interface ProfileApiSuccess {
  user: ProfileFormUser;
}

interface ProfileApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Profile editor for /account.
 *
 * Submits to `PUT /api/users/me` with `{ email?, name? | null }`. We
 * only send the fields the user actually changed so a no-op submit is
 * cheap and the backend's "at least one" guard never triggers
 * unexpectedly. Server-side `email_taken` (409) is mirrored into the
 * email field as an inline error.
 *
 * On success we toast and `router.refresh()` so the site header — which
 * is a server component reading `getCurrentUser()` — picks up the new
 * name/email immediately.
 */
export function ProfileForm({ user }: ProfileFormProps) {
  const router = useRouter();

  const initialValues: ProfileFormValues = React.useMemo(
    () => ({ name: user.name ?? "", email: user.email }),
    [user.email, user.name],
  );

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    mode: "onTouched",
    defaultValues: initialValues,
  });

  // Reset whenever the upstream user changes (e.g. after another tab
  // updated the profile and we re-rendered with fresh server data).
  React.useEffect(() => {
    form.reset(initialValues);
  }, [form, initialValues]);

  const onSubmit = async (values: ProfileFormValues) => {
    const trimmedName = (values.name ?? "").trim();
    const trimmedEmail = values.email.trim().toLowerCase();
    const currentName = (user.name ?? "").trim();

    // Build a sparse PUT body: only changed fields.
    const payload: { email?: string; name?: string | null } = {};
    if (trimmedEmail !== user.email.toLowerCase()) {
      payload.email = trimmedEmail;
    }
    if (trimmedName !== currentName) {
      // Empty string clears the column on the server side.
      payload.name = trimmedName.length === 0 ? null : trimmedName;
    }

    if (Object.keys(payload).length === 0) {
      toast.info("No changes", {
        description: "Your profile is already up to date.",
      });
      return;
    }

    try {
      const res = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let body: ProfileApiError | null = null;
        try {
          body = (await res.json()) as ProfileApiError;
        } catch {
          // not JSON — fall through
        }

        if (body?.fieldErrors) {
          for (const [field, messages] of Object.entries(body.fieldErrors)) {
            if (field === "email" || field === "name") {
              const message = messages?.[0];
              if (message) {
                form.setError(field, { type: "server", message });
              }
            }
          }
        }

        if (res.status === 409 || body?.code === "email_taken") {
          form.setError("email", {
            type: "server",
            message: "An account with that email already exists.",
          });
          toast.error("Email already in use", {
            description:
              "Try a different email address — that one is registered to another account.",
          });
          return;
        }

        if (res.status === 401) {
          toast.error("Session expired", {
            description: "Please sign in again to continue.",
          });
          router.replace("/login?next=/account");
          return;
        }

        toast.error("Couldn't update profile", {
          description:
            body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }

      const data = (await res.json()) as ProfileApiSuccess;
      toast.success("Profile updated", {
        description: "Your changes have been saved.",
      });
      // Reset the form to the canonical server values so the dirty
      // state collapses and the header picks up the new identity.
      form.reset({
        name: data.user.name ?? "",
        email: data.user.email,
      });
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
  const isDirty = form.formState.isDirty;

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-5"
        data-testid="profile-form"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  disabled={isSubmitting}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormDescription>
                Shown in the site header and on your receipts. Leave
                blank to clear it.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Used to sign in and receive account notifications.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
          {isDirty && !isSubmitting && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => form.reset(initialValues)}
            >
              Discard
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}
