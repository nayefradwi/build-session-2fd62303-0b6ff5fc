import Link from "next/link";
import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Register a new account to get started.",
};

interface RegisterPageProps {
  searchParams: Promise<{ redirect?: string | string[] }>;
}

/**
 * Sanitize a `?redirect=` query param. We only allow same-origin paths
 * that begin with a single "/" — anything else (absolute URLs,
 * protocol-relative URLs, etc.) is dropped so the form falls back to
 * the home page.
 */
function safeRedirect(input: string | string[] | undefined): string {
  const raw = Array.isArray(input) ? input[0] : input;
  if (!raw) return "/";
  if (typeof raw !== "string") return "/";
  // Must be a same-origin absolute path: starts with exactly one "/".
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  // Disallow nested control chars / whitespace.
  // Reject backslashes (IE collapses them) and whitespace/control chars.
  if (raw.includes("\\")) return "/";
  if (/\s/.test(raw)) return "/";
  return raw;
}

export default async function RegisterPage({
  searchParams,
}: RegisterPageProps) {
  const params = await searchParams;
  const redirectTo = safeRedirect(params.redirect);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="space-y-2 text-center">
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            Sign up with your email and a password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RegisterForm redirectTo={redirectTo} />
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
