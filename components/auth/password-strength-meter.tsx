"use client";

import * as React from "react";

import { cn } from "@/lib/client/utils";
import {
  passwordStrength,
  type PasswordStrength,
} from "@/lib/client/auth-schema";

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

const SEGMENT_COLORS: Record<PasswordStrength["score"], string> = {
  0: "bg-muted",
  1: "bg-destructive",
  2: "bg-orange-500",
  3: "bg-yellow-500",
  4: "bg-emerald-500",
};

const LABEL_COLORS: Record<PasswordStrength["score"], string> = {
  0: "text-muted-foreground",
  1: "text-destructive",
  2: "text-orange-600",
  3: "text-yellow-700",
  4: "text-emerald-600",
};

/**
 * Visual password strength feedback. Backed by the heuristic in
 * `lib/client/auth-schema.ts#passwordStrength`. Purely advisory — the
 * server enforces the actual minimum requirements.
 */
export function PasswordStrengthMeter({
  password,
  className,
}: PasswordStrengthMeterProps) {
  const { score, label } = React.useMemo(
    () => passwordStrength(password),
    [password],
  );

  return (
    <div
      className={cn("space-y-1.5", className)}
      role="status"
      aria-live="polite"
    >
      <div className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((segment) => {
          const filled = score >= segment;
          return (
            <div
              key={segment}
              className={cn(
                "h-1.5 rounded-full transition-colors",
                filled
                  ? SEGMENT_COLORS[score]
                  : "bg-muted",
              )}
              aria-hidden="true"
            />
          );
        })}
      </div>
      <p className={cn("text-xs", LABEL_COLORS[score])}>
        Password strength: <span className="font-medium">{label}</span>
      </p>
    </div>
  );
}
