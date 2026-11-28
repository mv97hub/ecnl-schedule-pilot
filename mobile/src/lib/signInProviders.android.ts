import { GoogleSignin, isErrorWithCode, statusCodes } from "@react-native-google-signin/google-signin";

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

export async function signInWithApple(): Promise<NativeIdentity> {
  throw new Error("Sign in with Apple is not available on Android.");
}

let googleConfigured = false;

export async function signInWithGoogle(): Promise<NativeIdentity> {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  if (!webClientId) throw new Error("Google sign-in is not configured for this build.");
  if (!googleConfigured) {
    GoogleSignin.configure({ webClientId });
    googleConfigured = true;
  }
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  try {
    const response = await GoogleSignin.signIn();
    if (response.type !== "success") return cancelled("google");
    const identityToken = response.data.idToken;
    if (!identityToken) throw new Error("Google did not return an account.");
    const displayName = response.data.user.name?.trim() || null;
    return { cancelled: false, provider: "google", identityToken, nonce: null, displayName };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) return cancelled("google");
    if (isErrorWithCode(error) && error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error("Google Play services are not available on this device.");
    }
    throw error;
  }
}
