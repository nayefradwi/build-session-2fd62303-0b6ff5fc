"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck } from "lucide-react";
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
import {
  forgotPasswordFormSchema,
  type ForgotPasswordFormValues,
} from "@/lib/client/auth-schema";

interface ForgotPasswordFormProps {
  /**
   * Where the "Back to sign in" link should point. Defaults to /login.
   */
  loginHref?: string;
}

interface ForgotPasswordApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Always shown to the user once the request resolves successfully —
 * intentionally identical regardless of whether the email matched a
 * real account, so the form does not leak account existence.
 */
const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for that email, we've sent a password reset link. Please check your inbox.";

/**
 * Client-side "forgot password" request form.
 *
 * Submits to `POST /api/auth/password-reset/request`. The backend
 * always responds 200 with a generic message regardless of whether the
 * email is registered, and we mirror that here: on a successful
 * response we render the same confirmation copy in every case so the
 * form cannot be used to enumerate accounts.
 *
 * The only state where we surface a different message is rate limiting
 * (429) — that's a server signal the user actually needs to see, and
 * it's keyed on (ip + email) so it doesn't leak existence either.
 */
export function ForgotPasswordForm({
  loginHref = "/login",
}: ForgotPasswordFormProps) {
  const [submittedEmail, setSubmittedEmail] = React.useState<string | null>(
    null,
  );

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    mode: "onTouched",
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email }),
      });

      if (!res.ok) {
        let body: ForgotPasswordApiError | null = null;
        try {
          body = (await res.json()) as ForgotPasswordApiError;
        } catch {
          // fall through to generic toast
        }

        if (body?.fieldErrors) {
          for (const [field, messages] of Object.entries(body.fieldErrors)) {
            if (field === "email") {
              const message = messages?.[0];
              if (message) {
                form.setError("email", { type: "server", message });
              }
            }
          }
        }

        if (res.status === 429 || body?.code === "rate_limited") {
          toast.error("Too many requests", {
            description:
              body?.error ??
              "You've requested too many resets. Please wait a few minutes before trying again.",
          });
          return;
        }

        // Don't leak existence in error states either — surface a
        // generic problem rather than the server's text when possible.
        toast.error("Something went wrong", {
          description:
            body?.error ?? "Could not submit your request. Please try again.",
        });
        return;
      }

      setSubmittedEmail(values.email);
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

  if (submittedEmail) {
    return (
      <div
        className="space-y-5 text-center"
        role="status"
        aria-live="polite"
        data-testid="forgot-password-success"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <MailCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            {GENERIC_SUCCESS_MESSAGE}
          </p>
          <p className="text-xs text-muted-foreground">
            The link will expire in 1 hour. If you don&apos;t see the email,
            check your spam folder or try again.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSubmittedEmail(null);
              form.reset({ email: "" });
            }}
          >
            Use a different email
          </Button>
          <Button asChild>
            <Link href={loginHref}>Back to sign in</Link>
          </Button>
        </div>
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
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending reset link…
            </>
          ) : (
            "Send reset link"
          )}
        </Button>
      </form>
    </Form>
  );
}
