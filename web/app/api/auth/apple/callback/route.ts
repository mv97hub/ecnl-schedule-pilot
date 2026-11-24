import { connection, type NextRequest } from "next/server";

import { AppleAuthError, appleIdentity, finishProvider, logAppleFailure, signInError } from "@/lib/oauth";

export async function POST(request: NextRequest): Promise<Response> {
  await connection();
  const path = request.nextUrl.pathname;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    logAppleFailure("callback", path, null, "unreadable_form");
    return signInError("Sign-in failed. Start again from Profile.");
  }
  const code = form.get("code");
  const appleError = form.get("error");
  const appleDetail = form.get("error_description");
  if ((typeof appleError === "string" && appleError) || typeof code !== "string" || !code) {
    logAppleFailure(
      "callback",
      path,
      typeof appleError === "string" ? appleError : null,
      typeof appleDetail === "string" ? appleDetail : null,
    );
    return signInError("Sign-in failed. Start again from Profile.");
  }
  try {
    const identity = await appleIdentity(code, form.get("user"));
    const state = form.get("state");
    return await finishProvider(request, identity, typeof state === "string" ? state : null);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Sign-in failed.";
    if (caught instanceof AppleAuthError) logAppleFailure("callback", path, caught.appleError, caught.detail);
    else logAppleFailure("callback", path, null, message);
    return signInError(message);
  }
}
