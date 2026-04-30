import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Package } from "lucide-react";

import { ProfileForm } from "@/components/account/profile-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Profile",
  description: "Update your profile and account details.",
};

export const dynamic = "force-dynamic";

/**
 * `/account` — profile editor and quick links to the rest of the
 * account section. The layout enforces auth, but we additionally call
 * `requireUser()` here so the typesystem knows we have a real user.
 */
export default async function AccountProfilePage() {
  const user = await requireUser();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Profile</CardTitle>
          <CardDescription>
            Update your name and the email you use to sign in. Email
            changes take effect immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            user={{
              id: user.id,
              email: user.email,
              name: user.name,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Order history</CardTitle>
          <CardDescription>
            Review past orders, track shipments, and download invoices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/account/orders" data-testid="order-history-link">
              <Package className="h-4 w-4" />
              View order history
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
