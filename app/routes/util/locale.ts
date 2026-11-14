import { data, redirect, type ActionFunctionArgs } from "react-router";

import { isLocale } from "~/i18n";
import { setLocale } from "~/i18n/locale.server";
import { appConfigContext } from "~/server/context";

export async function action({ request, context }: ActionFunctionArgs) {
  // This public endpoint only changes a non-sensitive display preference.
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw data("Forbidden", { status: 403 });
  }
  const origin = request.headers.get("Origin");
  if (origin !== null) {
    // TLS may terminate before this server. Trust the configured public URL,
    // never client-supplied Forwarded or X-Forwarded-* headers.
    const requestUrl = new URL(request.url);
    const publicUrl = new URL(context.get(appConfigContext).server.base_url ?? request.url);
    // runtime/http.ts aligns same-host Origin schemes with the local transport.
    // Permit that form only when its host (including port) is the public host.
    const matchesAlignedOrigin = requestUrl.host === publicUrl.host && origin === requestUrl.origin;
    if (origin !== publicUrl.origin && !matchesAlignedOrigin) {
      throw data("Forbidden", { status: 403 });
    }
  }
  const form = await request.formData();
  const locale = form.get("locale");
  if (!isLocale(locale)) throw data("Bad Request", { status: 400 });

  return redirect(safeReturnTo(form.get("returnTo")), {
    headers: { "Set-Cookie": await setLocale(locale) },
  });
}

function safeReturnTo(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 2048) return "/";
  try {
    const decoded = decodeURIComponent(value);
    // Reject control characters that URL parsing could strip from a redirect target.
    // oxlint-disable-next-line no-control-regex
    if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return "/";
    if (new URL(value, "https://headplane.invalid").origin !== "https://headplane.invalid")
      return "/";
    return value;
  } catch {
    return "/";
  }
}
