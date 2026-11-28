import { useState } from "react";

import { ApiError, acceptTerms, postProvider } from "@/lib/api";
import { finishSignIn, type SignInFrom } from "@/lib/finishSignIn";
import { TERMS_REQUIRED_MESSAGE, providerSignInDecision } from "@/lib/signInGate";
import { signInWithApple, signInWithGoogle } from "@/lib/signInProviders";
import type { ProviderSession } from "@/lib/types";

export function useProviderSignIn(from: SignInFrom, next: string | null) {
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreedState] = useState(false);

  function setAgreed(nextAgreed: boolean) {
    setAgreedState(nextAgreed);
    if (nextAgreed) setError((current) => (current === TERMS_REQUIRED_MESSAGE ? null : current));
  }

  async function run(provider: "apple" | "google") {
    const decision = providerSignInDecision(agreed, busy != null);
    if (decision === "wait") return;
    if (decision === "terms") {
      setError(TERMS_REQUIRED_MESSAGE);
      return;
    }
    setBusy(provider);
    setError(null);
    try {
      const identity = provider === "apple" ? await signInWithApple() : await signInWithGoogle();
      if (identity.cancelled || !identity.identityToken) return;
      const session: ProviderSession = await postProvider({
        provider: identity.provider,
        identityToken: identity.identityToken,
        nonce: identity.nonce,
        displayName: identity.displayName,
      });
      await acceptTerms(session.token);
      await finishSignIn(session, from, next);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "Sign-in failed.";
      setError(message);
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, agreed, setAgreed, run };
}
