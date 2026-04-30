"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import {
  resetPasswordFormSchema,
  type ResetPasswordFormValues,
} from "@/lib/client/auth-schema";

interface ResetPasswordFormProps {
  /**
   * Raw reset token from the URL. The form attaches this to the API
   * payload; the backend validates that it exists, hasn't expired, and
   * hasn't already been used.
   */
  token: string;
}

interface ResetPasswordApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Client-side "reset password" confirm form.
 *
 * Submits to `POST /api/auth/password-reset/confirm` with the raw
 * token plus the new password. Specialises three failure modes:
 *
 *   - `invalid_token`  → the link is bad or already consumed; we replace
 *                        the form with a "request a new link" state.
 *   - `weak_password`  → server-side password rules fired; mirror the
 *                        message back into the password field.
 *   - `rate_limited`   → toast and let them retry later.
 *
 * On success we replace the form with a confirmation panel that links
 * back to /login. The backend has already revoked all of this user's
 * sessions, so they really do need to sign in again.
 */
export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [tokenInvalid, setTokenInvalid] = React.useState(false);
  const [completed, setCompleted] = React.useState(false);

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    mode: "onTouched",
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const password = form.watch("password");

  const onSubmit = async (values: ResetPasswordFormValues) => {
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password: values.password,
        }),
      });

      if (!res.ok) {
        let body: ResetPasswordApiError | null = null;
        try {
          body = (await res.json()) as ResetPasswordApiError;
        } catch {
          // fall through to generic toast
        }

        if (body?.code === "invalid_token") {
          setTokenInvalid(true);
          return;
        }

        if (body?.fieldErrors) {
          for (const [field, messages] of Object.entries(body.fieldErrors)) {
            if (field === "password") {
              const message = messages?.[0];
              if (message) {
                form.setError("password", { type: "server", message });
              }
            }
          }
        }

        if (res.status === 429 || body?.code === "rate_limited") {
          toast.error("Too many attempts", {
            description:
              body?.error ??
              "You've tried too many times. Please wait a moment and try again.",
          });
          return;
        }

        if (body?.code === "weak_password") {
          // Field-level message already attached via fieldErrors above;
          // raise a toast as well so the user notices.
          toast.error("Password does not meet requirements", {
            description: body.error,
          });
          return;
        }

        toast.error("Could not reset password", {
          description:
            body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }

      setCompleted(true);
      toast.success("Password updated", {
        description: "Sign in with your new password to continue.",
      });
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

  if (tokenInvalid) {
    return (
      <div
        className="space-y-5 text-center"
        role="alert"
        data-testid="reset-password-invalid-token"
      >
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">This link is no longer valid</h2>
          <p className="text-sm text-muted-foreground">
            The reset link has expired or has already been used. Please
            request a new one to continue.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (completed) {
    return (
      <div
        className="space-y-5 text-center"
        role="status"
        aria-live="polite"
        data-testid="reset-password-success"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Password updated</h2>
          <p className="text-sm text-muted-foreground">
            Your password has been changed. For security, all of your
            existing sessions have been signed out — please sign in again
            to continue.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">Continue to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-5"
      >
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    disabled={isSubmitting}
                    className="pr-10"
                    {...field}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    aria-pressed={showPassword}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </FormControl>
              <PasswordStrengthMeter password={password ?? ""} />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter your new password"
                    disabled={isSubmitting}
                    className="pr-10"
                    {...field}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={
                      showConfirm
                        ? "Hide confirmation"
                        : "Show confirmation"
                    }
                    aria-pressed={showConfirm}
                    tabIndex={-1}
                  >
                    {showConfirm ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating password…
            </>
          ) : (
            "Update password"
          )}
        </Button>
      </form>
    </Form>
  );
}
