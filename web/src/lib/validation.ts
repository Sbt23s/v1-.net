/**
 * Field rules shared by every form that collects the same thing.
 *
 * The joining form and the profile form both ask for a name and an email, and
 * both had their own idea of what was acceptable -- the joining form rejected
 * addresses ending in .com, and the profile form accepted anything at all,
 * including a name typed as digits. One definition, used by both, is the only
 * way those two stay in agreement.
 */

/**
 * A usable email address.
 *
 * The domain ending is two letters or more: .com, .info and .org are ordinary
 * and a rule that only accepted two-letter endings rejected almost every real
 * address.
 *
 * Deliberately permissive about the rest. Addresses legitimately contain plus
 * signs, dots and subdomains, and a stricter expression turns away real people
 * far more often than it catches a typing mistake. The server validates it
 * again, and an address that is well-formed but wrong can only be found by
 * sending mail to it.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/**
 * A person's name: letters, with the punctuation names actually contain.
 *
 * Spaces for given and family names, a dot for initials, an apostrophe for
 * names like D'Souza, a hyphen for double-barrelled ones. Digits are not part
 * of anybody's name and are the mistake this is here to catch.
 */
export const NAME_PATTERN = /^[A-Za-z][A-Za-z .'-]*$/;

/** Validation rules for a react-hook-form `register` call. */
export const nameRules = {
  required: "Full name is required",
  validate: (v?: string) => {
    const value = (v ?? "").trim();
    if (!value) return "Full name is required";
    if (/\d/.test(value)) return "A name cannot contain numbers";
    if (!NAME_PATTERN.test(value)) return "Letters only";
    return true;
  }};

export const emailRules = {
  required: "Email is required",
  validate: (v?: string) => {
    const value = (v ?? "").trim();
    if (!value) return "Email is required";
    if (!EMAIL_PATTERN.test(value)) return "Enter a full email address, like name@gmail.com";
    return true;
  }};

/**
 * An Indian pincode: six digits, and nothing else.
 *
 * Optional on a profile — plenty of records have no address yet, and a field
 * that refuses to be left blank makes somebody invent one.
 */
export const PINCODE_PATTERN = /^\d{6}$/;

export const pincodeRules = {
  validate: (v?: string) => {
    const value = (v ?? "").trim();
    if (!value) return true;               // optional
    if (!/^\d+$/.test(value)) return "Digits only";
    if (!PINCODE_PATTERN.test(value)) return "A pincode is six digits";
    return true;
  }};

/**
 * Strip anything that is not a digit, for a field that only ever holds them.
 *
 * Used on input rather than only on submit: a letter that never appears is
 * clearer than one that appears and is then complained about, and it stops a
 * pasted "560 001" or "PIN-560001" from becoming an error the person has to
 * work out for themselves.
 */
export function digitsOnly(value: string, max?: number): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return max ? digits.slice(0, max) : digits;
}
