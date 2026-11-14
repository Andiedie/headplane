---
title: Languages
description: Switch between English and Simplified Chinese.
---

Headplane supports English and Simplified Chinese (`zh-CN`). English is the
default. Browser language settings do not change this default.

## Choose a language

Open the language menu in the top bar or on the sign-in page. Choose **English**
or **简体中文**. The current page, query parameters and fragment are retained.

The choice is stored in the `headplane_locale` cookie for this browser. It
applies before and after signing in and is not an account setting. Clearing
cookies restores English. No server configuration or database migration is
required.

The server renders the chosen language on the first response and sets the
page's `lang` attribute. Interface text, owned action messages and date/time
formatting follow that language. Missing translations fall back to English.

Machine names, user names, addresses, tags, commands, policy/configuration
contents, and terminal output are not translated. Raw diagnostic details from
Headscale or other dependencies may remain in their original language. The
documentation website is separate from the application's language choice.
Browser-provided form validation messages follow the browser's language;
Headplane leaves native validation and component-library behavior unchanged.

## Maintain translations

Message catalogs live in `app/i18n/messages/`, grouped by feature. Each module
exports the English source messages (`en`) and Simplified Chinese messages
(`zhCN`). Keep keys stable and describe their meaning rather than their visual
position. Add feature catalogs to `app/i18n/catalog.ts`.

Use `useI18n().t(key, values)` for text and `Trans` for complete messages with
React elements as placeholders. Both use named placeholders such as `{name}`;
user values are not interpreted as translation markup. Keep placeholders
consistent between languages and avoid assembling sentences from translated
fragments.

Server-side translation receives the locale from the current request. Do not
store a mutable current language in module state. Keep protocol fields,
permission identifiers, stored audit values and numeric form submissions
independent of the display language.

Keep localization changes separate from unrelated features and deployment
configuration when preparing upstream contributions. English remains the
fallback so new upstream messages can be translated incrementally.
