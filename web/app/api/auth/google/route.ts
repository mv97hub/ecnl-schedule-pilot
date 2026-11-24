import { connection, type NextRequest } from "next/server";

import { beginProvider } from "@/lib/oauth";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  return beginProvider(request, "google");
}
