import { Check, Languages } from "lucide-react";
import { useLocation, useSubmit } from "react-router";

import { Menu, MenuContent, MenuItem, MenuTrigger } from "~/components/menu";
import { useI18n } from "~/i18n/react";

export default function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const location = useLocation();
  const submit = useSubmit();
  const returnTo = location.pathname + location.search + location.hash;
  return (
    <Menu>
      <MenuTrigger
        aria-label={t("common.language")}
        className="text-muted hover:bg-hover hover:text-fg flex h-8 items-center gap-1.5 rounded-md px-2 text-xs"
      >
        <Languages aria-hidden className="size-4" />
        <span>{locale === "zh-CN" ? "中文" : "EN"}</span>
      </MenuTrigger>
      <MenuContent align="end">
        {(
          [
            ["en", "English"],
            ["zh-CN", "简体中文"],
          ] as const
        ).map(([value, label]) => (
          <MenuItem
            key={value}
            onClick={() =>
              submit({ locale: value, returnTo }, { action: "/api/locale", method: "POST" })
            }
          >
            <span className="flex-1" lang={value}>
              {label}
            </span>
            {locale === value && <Check aria-hidden className="size-4" />}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
