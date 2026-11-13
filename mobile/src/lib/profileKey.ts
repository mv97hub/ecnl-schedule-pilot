import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const PROFILE_KEY = "ecnl-profile-key";

/**
 * A device id kept for a future account migration.
 * v1 must not send this value to the server.
 */
export async function ensureProfileKey(): Promise<void> {
  try {
    const existing = await SecureStore.getItemAsync(PROFILE_KEY);
    if (existing) return;
    const bytes = await Crypto.getRandomBytesAsync(16);
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await SecureStore.setItemAsync(PROFILE_KEY, id);
  } catch {
    // Web preview has no secure enclave. The key is still never attached to a request.
  }
}
