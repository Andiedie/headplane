import type { ActionFunctionArgs } from "react-router";
import * as v from "valibot";

import { translate, type Locale, type MessageKey, type MessageValues } from "~/i18n";
import { localizedHeadscaleErrorMessage, translateValidationErrors } from "~/i18n/action-errors";
import { getLocale } from "~/i18n/locale.server";
import { actionAuditContext, authContext } from "~/server/context";
import { isUserPrincipal, type Principal } from "~/server/web/auth";
import type { Capabilities } from "~/server/web/roles";
import { type ActionResult, formValues, invalid, parseValues } from "~/utils/form";

// Every possible action state. If a regular Error is thrown it's a bug
export class ActionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly localization?: { key: MessageKey; values?: MessageValues },
  ) {
    super(message);
  }
}

type HandlerResult = ActionResult | Response | ReturnType<typeof invalid>;

interface Intent<E extends v.ObjectEntries, C> {
  fields: E;
  auditTarget?: keyof E & ("node_id" | "headplane_user_id" | "headscale_user_id");
  capability?: Capabilities;
  handler: (
    input: v.InferOutput<v.ObjectSchema<E, undefined>>,
    ctx: C,
    locale: Locale,
  ) => Promise<HandlerResult>;
}

interface ActionOptions<C, T extends Record<string, v.ObjectEntries>> {
  audit?: boolean;
  capability?: Capabilities;
  setup: (args: ActionFunctionArgs) => Promise<C>;
  intents: { [K in keyof T]: Intent<T[K], C> };
}

export function createAction<
  C extends { principal: Principal },
  T extends Record<string, v.ObjectEntries>,
>(options: ActionOptions<C, T>) {
  const action = async (args: ActionFunctionArgs) => {
    const auth = args.context.get(authContext);
    const locale = await getLocale(args.request);

    try {
      const ctx = await options.setup(args);
      const values = formValues(await args.request.formData());
      const name = String(values.intent ?? "");

      if (!Object.hasOwn(options.intents, name)) {
        return invalid({ form: translate(locale, "errors.unsupportedAction") });
      }

      const intent = options.intents[name];
      for (const capability of [options.capability, intent.capability]) {
        if (capability !== undefined && !auth.can(ctx.principal, capability)) {
          throw new ActionError("You don't have permission to do this.", 403, {
            key: "errors.permissionDenied",
          });
        }
      }

      const parsed = parseValues(v.object(intent.fields), values);
      if (!parsed.ok) {
        return invalid(translateValidationErrors(locale, parsed.errors));
      }

      const audit = async (outcome: "success" | "failed") => {
        if (options.audit === false) return;
        const record = args.context.get(actionAuditContext);
        if (!record) return;
        const field = intent.auditTarget;
        const target = field ? parsed.data[field] : undefined;
        const validTarget =
          typeof target === "string" &&
          (field === "headplane_user_id"
            ? v.is(v.pipe(v.string(), v.ulid()), target)
            : /^[1-9]\d{0,19}$/.test(target));
        // Deliberately exclude form values, response bodies, API keys and URLs' queries.
        await record({
          actor: isUserPrincipal(ctx.principal) ? ctx.principal.user.id : "api-key-session",
          intent: name,
          path: new URL(args.request.url).pathname,
          outcome,
          target: validTarget ? target : undefined,
        });
      };
      try {
        const result = await intent.handler(parsed.data, ctx, locale);
        const failed =
          result instanceof Response
            ? result.status >= 400
            : "ok" in result
              ? !result.ok
              : !result.data.ok;
        await audit(failed ? "failed" : "success");
        return result;
      } catch (error) {
        await audit("failed");
        throw error;
      }
    } catch (error) {
      if (error instanceof ActionError) {
        const message = error.localization
          ? translate(locale, error.localization.key, error.localization.values)
          : error.message;
        return invalid({ form: message }, error.status);
      }

      const message = localizedHeadscaleErrorMessage(error, locale);
      if (message) {
        return invalid({ form: message });
      }

      throw error;
    }
  };

  // Allows the testing harness to iterate all the intents
  return Object.assign(action, { intents: Object.keys(options.intents) });
}
