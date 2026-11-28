export type NativeIdentity = {
  cancelled: boolean;
  provider: "apple" | "google";
  identityToken: string;
  nonce: string | null;
  displayName: string | null;
};

export async function signInWithApple(): Promise<NativeIdentity> {
  throw new Error("Sign in with Apple is not available on this device.");
}

export async function signInWithGoogle(): Promise<NativeIdentity> {
  throw new Error("Continue with Google is not available on this device.");
}
