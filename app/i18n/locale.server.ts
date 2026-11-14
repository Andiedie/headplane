import { createCookie } from "react-router";

import { isLocale, type Locale } from "./types";

export const localeCookie = createCookie("headplane_locale", {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax",
  httpOnly: true,
});

export async function getLocale(request: Request): Promise<Locale> {
  try {
    const value: unknown = await localeCookie.parse(request.headers.get("Cookie"));
    return isLocale(value) ? value : "en";
  } catch {
    return "en";
  }
}

export function setLocale(locale: Locale) {
  return localeCookie.serialize(locale);
}
