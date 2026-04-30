import { z } from "zod";

/**
 * Client-side schema for the profile form on `/account`.
 *
 * Mirrors the server contract in `app/api/users/me/route.ts`:
 *   - `email` is required and validated as an email.
 *   - `name` is optional; an empty string clears it (the server treats
 *     missing or null as "no change", and empty/whitespace as "clear").
 *
 * Server stays the source of truth for things we can't check locally
 * (uniqueness collisions). Those errors come back as `email_taken` and
 * are surfaced as inline field errors by the form component.
 */
export const profileFormSchema = z.object({
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
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
