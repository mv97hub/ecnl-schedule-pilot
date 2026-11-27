import { ApiError, fetchMe } from "@/lib/api";
import { readChoicePending, readStoredToken } from "@/lib/tokenStore";
import { useAccount } from "@/store/account";

/** Read the secure-store token, then the account. A 401 drops the token and stays in the app. */
export async function loadAccount(): Promise<void> {
  const token = await readStoredToken();
  if (!token) {
    useAccount.getState().setReady(true);
    return;
  }
  const choicePending = await readChoicePending();
  useAccount.setState({ token, ready: true, choicePending });
  try {
    const me = await fetchMe(token);
    if (useAccount.getState().token !== token) return;
    useAccount.getState().setUser(me);
  } catch (error) {
    if (useAccount.getState().token !== token) return;
    if (error instanceof ApiError && error.status === 401) useAccount.getState().clearSession();
  }
}
