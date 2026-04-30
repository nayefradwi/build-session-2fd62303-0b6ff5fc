"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
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
  loginFormSchema,
  type LoginFormValues,
} from "@/lib/client/auth-schema";

interface LoginFormProps {
  /**
   * Where to send the user after a successful login. The login page
   * resolves this from `?next=` / `?redirect=` (sanitised same-origin
   * paths only). Defaults to "/" if no caller-provided redirect target.
   */
  redirectTo?: string;
}

interface LoginApiSuccess {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  session: {
    expiresAt: string;
  };
}

interface LoginApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Client-side login form.
 *
 * Submits to `POST /api/auth/login`. The backend route sets the
 * httpOnly session cookie on the response; on success we navigate to
 * the redirect target and refresh so server components (including the
 * site header) re-render with the new auth state.
 *
 * Cookies are httpOnly + SameSite=Lax + path=/, so the session is
 * automatically shared across every tab on the same origin.
 */
export function LoginForm({ redirectTo = "/" }: LoginFormProps) {
  const router = useRouter();
  const [showPassword, setShowPassword] = React.useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    mode: "onTouched",
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Honour Set-Cookie on the response.
        credentials: "same-origin",
        body: JSON.stringify({
          email: values.email,
          password: values.password,
        }),
      });

      if (!res.ok) {
        let body: LoginApiError | null = null;
        try {
          body = (await res.json()) as LoginApiError;
        } catch {
          // Body wasn't JSON — fall through to a generic error.
        }

        // Surface zod field errors back into the form, when present.
        if (body?.fieldErrors) {
          for (const [field, messages] of Object.entries(body.fieldErrors)) {
            if (field === "email" || field === "password") {
              const message = messages?.[0];
              if (message) {
                form.setError(field, { type: "server", message });
              }
            }
          }
        }

        if (res.status === 401 || body?.code === "invalid_credentials") {
          // Backend deliberately returns a generic message so we don't
          // leak which of email/password was wrong. Mirror that here:
          // attach the error to both fields plus a top-level toast.
          const message = "Invalid email or password";
          form.setError("email", { type: "server", message });
          form.setError("password", { type: "server", message });
          toast.error("Sign in failed", {
            description: "Please double-check your email and password.",
          });
          return;
        }

        if (res.status === 429 || body?.code === "rate_limited") {
          toast.error("Too many attempts", {
            description:
              body?.error ??
              "You've tried too many times. Please wait a moment and try again.",
          });
          return;
        }

        toast.error("Sign in failed", {
          description:
            body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }

      // Cookie is now set on this response, so subsequent requests are
      // authenticated. Welcome the user, navigate, and refresh server
      // components so the header reflects the logged-in state.
      const data = (await res.json()) as LoginApiSuccess;
      toast.success("Welcome back!", {
        description: data.user.name
          ? `Signed in as ${data.user.name}.`
          : `Signed in as ${data.user.email}.`,
      });

      router.replace(redirectTo);
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

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Your password"
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
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </Form>
  );
}
