import { connection, type NextRequest } from "next/server";

const REQUEST_HEADERS = ["accept", "content-type", "x-profile-key"];

/**
 * Same origin the website uses. Read after `connection()` so a Render
 * runtime value is not frozen into a prerendered response.
 */
async function apiOrigin(): Promise<string> {
  await connection();
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  return (configured || "http://127.0.0.1:8000").replace(/\/$/, "");
}

function upstreamUrl(origin: string, path: string[], search: string): URL | null {
  if (path.length === 0) return null;
  for (const segment of path) {
    if (!segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
      return null;
    }
  }
  const url = new URL(origin);
  const prefix = url.pathname.replace(/\/$/, "");
  url.pathname = `${prefix}/${path.map((segment) => encodeURIComponent(segment)).join("/")}`;
  url.search = search;
  return url;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  const target = upstreamUrl(await apiOrigin(), path, request.nextUrl.search);
  if (!target) {
    return Response.json({ detail: "Invalid path" }, { status: 400 });
  }

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return Response.json({ detail: "API unavailable" }, { status: 502 });
  }

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  const location = upstream.headers.get("location");
  if (location) responseHeaders.set("location", location);
  responseHeaders.set("cache-control", "private, no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
