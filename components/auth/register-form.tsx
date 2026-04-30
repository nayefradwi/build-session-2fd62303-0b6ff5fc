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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import {
  registerFormSchema,
  type RegisterFormValues,
} from "@/lib/client/auth-schema";

interface RegisterFormProps {
  /**
   * Where to send the user after a successful registration. Defaults
   * to "/" if the caller does not pass a sanitized redirect target.
   */
  redirectTo?: string;
}

interface RegisterApiSuccess {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  session: {
    expiresAt: string;
  };
}

interface RegisterApiError {
  error: string;
  code: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Client-side registration form.
 *
 * Submits to `POST /api/auth/register`. The backend route sets the
 * httpOnly session cookie on the response, so on success we just need
 * to navigate — the next request will already be authenticated.
 */
export function RegisterForm({ redirectTo = "/" }: RegisterFormProps) {
  const router = useRouter();
  const [showPassword, setShowPassword] = React.useState(false);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  const password = form.watch("password");

  const onSubmit = async (values: RegisterFormValues) => {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Ensure the Set-Cookie response is honoured.
        credentials: "same-origin",
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          name: values.name?.trim() ? values.name.trim() : undefined,
        }),
      });

      if (!res.ok) {
        let body: RegisterApiError | null = null;
        try {
          body = (await res.json()) as RegisterApiError;
        } catch {
          // fall through; we'll show a generic error below.
        }

        // Surface field-level errors back into the form.
        if (body?.fieldErrors) {
          for (const [field, messages] of Object.entries(body.fieldErrors)) {
            if (
              field === "email" ||
              field === "password" ||
              field === "name"
            ) {
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
            message: "An account with that email already exists",
          });
          toast.error("Email already registered", {
            description:
              "Try signing in instead, or use a different email address.",
          });
          return;
        }

        toast.error("Registration failed", {
          description:
            body?.error ?? "Something went wrong. Please try again.",
        });
        return;
      }

      // The backend already set the session cookie on this response,
      // so the user is effectively logged in. Show feedback + navigate.
      const data = (await res.json()) as RegisterApiSuccess;
      toast.success("Welcome aboard!", {
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
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormDescription>Optional. Shown on your profile.</FormDescription>
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

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>
    </Form>
  );
}
