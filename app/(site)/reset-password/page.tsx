import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your account.",
};

interface ResetPasswordPageProps {
  searchParams: Promise<{
    token?: string | string[];
  }>;
}

/**
 * /reset-password?token=...
 *
 * Reads the raw token out of the query string, hands it to the form
 * component, and renders an "invalid link" panel if it's missing.
 *
 * We don't try to *validate* the token here (the backend doesn't
 * expose a peek endpoint, and round-tripping just to check would
 * defeat the single-use guarantee of the confirm route). Instead, the
 * form submits the token along with the new password and the backend
 * tells us whether the token is good — at which point the form
 * swaps in its `invalid_token` error UI.
 */
export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="space-y-2 text-center">
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>
            Pick a strong password you haven&apos;t used before. After you
            update it, you&apos;ll need to sign in again on every device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <div
              className="space-y-5 text-center"
              role="alert"
              data-testid="reset-password-missing-token"
            >
              <div className="space-y-2">
                <h2 className="text-lg font-semibold">
                  Missing reset token
                </h2>
                <p className="text-sm text-muted-foreground">
                  This link is incomplete. Please use the link in the email
                  we sent you, or request a new one.
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
          )}
          <p className="text-center text-sm text-muted-foreground">
            Need help?{" "}
            <Link
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
