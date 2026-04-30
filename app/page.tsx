import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/server/auth";

export default async function HomePage() {
  // The header already greets the user, but we tailor the hero copy
  // and the primary CTA based on auth state too.
  const user = await getCurrentUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div className="space-y-3 max-w-xl">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          {user ? `Welcome back${user.name ? `, ${user.name}` : ""}!` : "Welcome"}
        </h1>
        <p className="text-muted-foreground">
          {user
            ? "You're signed in. Use the navigation above to continue."
            : "Create an account or sign in to get started."}
        </p>
      </div>
      {!user && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link href="/register">Create account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      )}
    </main>
  );
}
