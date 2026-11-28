/** Shown when Apple or Google is tapped before the terms box is checked. */
export const TERMS_REQUIRED_MESSAGE = "Agree to the Terms of Use before you sign in.";

export function providerSignInDecision(agreed: boolean, busy: boolean): "wait" | "terms" | "go" {
  if (busy) return "wait";
  if (!agreed) return "terms";
  return "go";
}
