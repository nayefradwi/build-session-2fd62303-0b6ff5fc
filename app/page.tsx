import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div className="space-y-3 max-w-xl">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Welcome
        </h1>
        <p className="text-muted-foreground">
          Create an account to get started.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/register">Create account</Link>
        </Button>
      </div>
    </main>
  );
}
