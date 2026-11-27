import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "ecnl-session-token";
const CHOICE_KEY = "ecnl-favorite-choice";

export async function readStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function writeStoredToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // Web preview has no secure enclave. The token stays in memory for this visit.
  }
}

export async function deleteStoredToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // The in-memory session is cleared by the caller.
  }
  await writeChoicePending(false);
}

export async function readChoicePending(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(CHOICE_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function writeChoicePending(pending: boolean): Promise<void> {
  try {
    if (pending) await SecureStore.setItemAsync(CHOICE_KEY, "1");
    else await SecureStore.deleteItemAsync(CHOICE_KEY);
  } catch {
    // The in-memory flag still routes this visit.
  }
}
