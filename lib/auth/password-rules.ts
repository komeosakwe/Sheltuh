/**
 * The password rules every form that sets one checks before Supabase is
 * called (sign up, reset, an account invite's "Create account"). Supabase
 * Auth's own password policy still has the last word.
 */
export const PASSWORD_HINT = "At least 8 characters, with an uppercase letter, a lowercase letter and a number.";
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
