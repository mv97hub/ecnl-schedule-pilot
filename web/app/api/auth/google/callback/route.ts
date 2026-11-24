import { connection, type NextRequest } from "next/server";

import { finishProvider, googleIdentity, signInError } from "@/lib/oauth";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const code = request.nextUrl.searchParams.get("code");
  if (request.nextUrl.searchParams.get("error") || !code) {
    return signInError(request, "Sign-in failed. Start again from Profile.");
  }
  try {
    const identity = await googleIdentity(code);
    return await finishProvider(request, identity, request.nextUrl.searchParams.get("state"));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Sign-in failed.";
    return signInError(request, message);
  }
}
