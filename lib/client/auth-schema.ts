import { z } from "zod";

/**
 * Client-side mirror of the server's password rules
 * (kept in sync with `PASSWORD_RULES` in `lib/server/auth.ts`).
 *
 * The server is the source of truth — these rules exist purely so we
 * can show real-time feedback before round-tripping to the API.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Zod schema for the registration form. */
export const registerFormSchema = z.object({
  name: z
    .string()
    .trim()
    .max(200, "Name must be at most 200 characters")
    .optional()
    .or(z.literal("")),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `At most ${PASSWORD_MAX_LENGTH} characters`)
    .regex(/[A-Za-z]/, "Must contain at least one letter")
    .regex(/[0-9]/, "Must contain at least one number"),
});

export type RegisterFormValues = z.infer<typeof registerFormSchema>;

/**
 * Zod schema for the login form.
 *
 * We intentionally do NOT enforce the registration password rules here —
 * an existing account may have been created under different rules, and
 * we'd rather show the server's "Invalid email or password" response
 * than block submission client-side.
 */
export const loginFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").max(1024),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

/** Zod schema for the "forgot password" request form. */
export const forgotPasswordFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
});

export type ForgotPasswordFormValues = z.infer<
  typeof forgotPasswordFormSchema
>;

/**
 * Zod schema for the "reset password" confirm form.
 *
 * Mirrors the registration password rules — they're applied to a *new*
 * password, so the same minimum strength makes sense. The confirm field
 * has to match the password field exactly, otherwise we'd risk
 * locking the user out of the account they're trying to recover.
 */
export const resetPasswordFormSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters`)
      .max(PASSWORD_MAX_LENGTH, `At most ${PASSWORD_MAX_LENGTH} characters`)
      .regex(/[A-Za-z]/, "Must contain at least one letter")
      .regex(/[0-9]/, "Must contain at least one number"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

/**
 * Computed password strength on a 0–4 scale plus a label.
 *
 * The thresholds are intentionally simple — this is UX feedback, not a
 * security boundary. Real strength enforcement happens server-side.
 */
export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
}

/** Heuristic password strength meter. */
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw || pw.length < PASSWORD_MIN_LENGTH) {
    return { score: 0, label: "Too short" };
  }

  let score = 0;
  if (pw.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;

  // Clamp to 1–4 once we've passed the minimum length so the meter
  // never sits at 0 for an otherwise valid (but boring) password.
  const clamped = Math.min(4, Math.max(1, score - 1)) as 1 | 2 | 3 | 4;

  const labels: Record<1 | 2 | 3 | 4, PasswordStrength["label"]> = {
    1: "Weak",
    2: "Fair",
    3: "Good",
    4: "Strong",
  };

  return { score: clamped, label: labels[clamped] };
}
