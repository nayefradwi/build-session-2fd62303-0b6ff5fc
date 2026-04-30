import Link from "next/link";
import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your account.",
};

interface LoginPageProps {
  searchParams: Promise<{
    next?: string | string[];
    redirect?: string | string[];
  }>;
}

/**
 * Sanitize a redirect target. Only same-origin absolute paths
 * (starting with exactly one "/", no whitespace, no backslashes) are
 * allowed; everything else falls back to "/" so an attacker cannot
 * craft an open-redirect via `?next=` or `?redirect=`.
 */
function safeRedirect(input: string | string[] | undefined): string | null {
  const raw = Array.isArray(input) ? input[0] : input;
  if (!raw || typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  if (/\s/.test(raw)) return null;
  // Don't redirect right back to the auth pages — that's a UX trap.
  if (raw === "/login" || raw.startsWith("/login?")) return null;
  if (raw === "/register" || raw.startsWith("/register?")) return null;
  return raw;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  // Middleware redirects protected pages to `/login?next=…`; we also
  // accept `?redirect=` for parity with the registration flow.
  const redirectTo =
    safeRedirect(params.next) ?? safeRedirect(params.redirect) ?? "/";

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="space-y-2 text-center">
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Welcome back. Enter your credentials to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <LoginForm redirectTo={redirectTo} />
          <div className="space-y-2 text-center text-sm text-muted-foreground">
            <p>
              <Link
                href="/forgot-password"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Forgot your password?
              </Link>
            </p>
            <p>
              Don&apos;t have an account?{" "}
              <Link
                href={`/register${
                  redirectTo && redirectTo !== "/"
                    ? `?redirect=${encodeURIComponent(redirectTo)}`
                    : ""
                }`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Create one
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
