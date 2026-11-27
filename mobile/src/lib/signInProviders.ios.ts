import { GoogleSignin, isErrorWithCode, statusCodes } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

export type NativeIdentity = {
  cancelled: boolean;
  provider: "apple" | "google";
  identityToken: string;
  nonce: string | null;
  displayName: string | null;
};

const cancelled = (provider: "apple" | "google"): NativeIdentity => ({
  cancelled: true,
  provider,
  identityToken: "",
  nonce: null,
  displayName: null,
});

function appleCancel(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: string }).code === "ERR_REQUEST_CANCELED"
  );
}

export async function signInWithApple(): Promise<NativeIdentity> {
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) throw new Error("Sign in with Apple is not available on this device.");
  const bytes = await Crypto.getRandomBytesAsync(16);
  const rawNonce = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  // Expo 58 and Apple both copy this string through. Hash it once here, as lowercase hex.
  // The API hashes the raw nonce the same way and compares that to the token.
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) throw new Error("Apple did not return an account.");
    const displayName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(" ").trim();
    return {
      cancelled: false,
      provider: "apple",
      identityToken: credential.identityToken,
      nonce: rawNonce,
      displayName: displayName || null,
    };
  } catch (error) {
    if (appleCancel(error)) return cancelled("apple");
    throw error;
  }
}

let googleConfigured = false;

export async function signInWithGoogle(): Promise<NativeIdentity> {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (!iosClientId) throw new Error("Google sign-in is not configured for this build.");
  if (!googleConfigured) {
    GoogleSignin.configure({ iosClientId });
    googleConfigured = true;
  }
  try {
    const response = await GoogleSignin.signIn();
    if (response.type !== "success") return cancelled("google");
    const identityToken = response.data.idToken;
    if (!identityToken) throw new Error("Google did not return an account.");
    const displayName = response.data.user.name?.trim() || null;
    return { cancelled: false, provider: "google", identityToken, nonce: null, displayName };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) return cancelled("google");
    throw error;
  }
}
