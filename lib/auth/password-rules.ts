/**
 * The password rules every form that sets one checks before Supabase is
 * called (sign up, reset, an account invite's "Create account"). They match
 * the Supabase Auth policy in docs/supabase-setup.md (min length 8, lower,
 * upper, digit); Supabase still has the last word.
 */
export const PASSWORD_RULES: readonly { id: string; label: string; met: (password: string) => boolean }[] = [
  { id: "length", label: "8+ characters", met: (p) => p.length >= 8 },
  { id: "upper", label: "Uppercase letter", met: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "Lowercase letter", met: (p) => /[a-z]/.test(p) },
  { id: "number", label: "Number", met: (p) => /\d/.test(p) },
];

export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export const PASSWORD_UNMET_ERROR = "Password doesn't meet the requirements.";

/** The inline error for a password: `emptyMessage` when empty, the rules message when short of them, else undefined. */
export function passwordError(password: string, emptyMessage: string): string | undefined {
  if (!password) return emptyMessage;
  return PASSWORD_REGEX.test(password) ? undefined : PASSWORD_UNMET_ERROR;
}

/** Loose address check (one "@", a dot in the domain, no spaces); Supabase validates for real. */
export function emailError(email: string): string | undefined {
  const value = email.trim();
  if (!value) return "Enter your email";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : "Enter a valid email";
}
