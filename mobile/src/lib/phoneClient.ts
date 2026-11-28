/** `POST /auth/provider` accepts ios or android. Web sign-in does not use this path. */
export function phoneClient(os: string): "ios" | "android" {
  return os === "android" ? "android" : "ios";
}
