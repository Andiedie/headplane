export type Locale = "en" | "zh-CN";
export type MessageValues = Readonly<Record<string, string | number>>;

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-CN";
}
