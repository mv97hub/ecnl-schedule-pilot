export type NativeIdentity = {
  cancelled: boolean;
  provider: "apple" | "google";
  identityToken: string;
  nonce: string | null;
  displayName: string | null;
};

export async function signInWithApple(): Promise<NativeIdentity> {
  throw new Error("Sign in with Apple needs the iOS app.");
}

export async function signInWithGoogle(): Promise<NativeIdentity> {
  throw new Error("Continue with Google needs the iOS app.");
}
