import { createContext, Fragment, useContext, useMemo, type ReactNode } from "react";

import { message, translate, type Locale, type MessageKey, type MessageValues } from ".";

interface I18nContextValue {
  locale: Locale;
  t: (key: MessageKey, values?: MessageValues) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  t: (key, values) => translate("en", key, values),
});

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: (key, values) => translate(locale, key, values) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function Trans({
  id,
  values = {},
}: {
  id: MessageKey;
  values?: Readonly<Record<string, ReactNode>>;
}) {
  const { locale } = useI18n();
  const parts = message(locale, id).split(/(\{[a-zA-Z][a-zA-Z0-9_]*\})/g);
  return parts.map((part, index) => {
    const name = part.slice(1, -1);
    return (
      <Fragment key={index}>
        {part.startsWith("{") && part.endsWith("}") && Object.hasOwn(values, name)
          ? values[name]
          : part}
      </Fragment>
    );
  });
}
