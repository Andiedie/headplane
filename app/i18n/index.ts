import { chinese, english } from "./catalog";
import type { Locale, MessageValues } from "./types";

export { isLocale } from "./types";
export type { Locale, MessageValues } from "./types";
export type MessageKey = keyof typeof english;

export function message(locale: Locale, key: MessageKey): string {
  return (locale === "zh-CN" ? chinese[key] : undefined) ?? english[key];
}

export function interpolate(template: string, values: MessageValues = {}): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}

export function translate(locale: Locale, key: MessageKey, values?: MessageValues): string {
  return interpolate(message(locale, key), values);
}
