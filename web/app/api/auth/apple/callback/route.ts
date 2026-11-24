import { connection, type NextRequest } from "next/server";

import { appleIdentity, finishProvider, signInError } from "@/lib/oauth";

export async function POST(request: NextRequest): Promise<Response> {
  await connection();
  const form = await request.formData();
  const code = form.get("code");
  if (form.get("error") || typeof code !== "string" || !code) {
    return signInError("Sign-in failed. Start again from Profile.");
  }
  try {
    const identity = await appleIdentity(code, form.get("user"));
    const state = form.get("state");
    return await finishProvider(request, identity, typeof state === "string" ? state : null);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Sign-in failed.";
    return signInError(message);
  }
}
