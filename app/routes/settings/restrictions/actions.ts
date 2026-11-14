import * as v from "valibot";

import { translate } from "~/i18n";
import { translateValidationErrors } from "~/i18n/action-errors";
import {
  authContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
} from "~/server/context";
import { ActionError, createAction } from "~/server/web/actions";
import { Capabilities } from "~/server/web/roles";
import { invalid, ok, parseValues } from "~/utils/form";

import { restrictionTypes, restrictionValue, type RestrictionType } from "./schemas";

const configPaths = {
  domain: { path: "oidc.allowed_domains", key: "allowedDomains" },
  group: { path: "oidc.allowed_groups", key: "allowedGroups" },
  user: { path: "oidc.allowed_users", key: "allowedUsers" },
} as const;

const successMessages = {
  domain: { added: "actions.restrictionDomainAdded", removed: "actions.restrictionDomainRemoved" },
  group: { added: "actions.restrictionGroupAdded", removed: "actions.restrictionGroupRemoved" },
  user: { added: "actions.restrictionUserAdded", removed: "actions.restrictionUserRemoved" },
} as const;
const duplicateErrors = {
  domain: "errors.restrictionDomainExists",
  group: "errors.restrictionGroupExists",
  user: "errors.restrictionUserExists",
} as const;
const missingErrors = {
  domain: "errors.restrictionDomainMissing",
  group: "errors.restrictionGroupMissing",
  user: "errors.restrictionUserMissing",
} as const;

export const restrictionAction = createAction({
  capability: Capabilities.configure_iam,
  async setup({ request, context }) {
    const principal = await context.get(authContext).require(request);
    const headscale = context.get(headscaleContext);
    const config = context.get(headscaleConfigContext);
    const integration = context.get(integrationContext);
    if (!config.writable()) {
      throw new ActionError("The Headscale configuration is read-only.", 403, {
        key: "errors.configReadOnly",
      });
    }

    function current(type: RestrictionType) {
      return config.getOIDCConfig()?.[configPaths[type].key] ?? [];
    }

    async function save(type: RestrictionType, values: string[]) {
      await config.patch([{ path: configPaths[type].path, value: values }]);
      if (integration && !(await integration.onConfigChange(headscale))) {
        throw new ActionError(
          "Saved, but Headscale didn't come back after restarting. Check its logs.",
          502,
          { key: "errors.restartFailed" },
        );
      }
    }

    return { principal, current, save };
  },
  intents: {
    add: {
      fields: { type: v.picklist(restrictionTypes), value: v.string() },
      async handler(input, { current, save }, locale) {
        const value = parseValues(restrictionValue[input.type], input.value);
        if (!value.ok) {
          return invalid(translateValidationErrors(locale, { value: value.errors.form }));
        }

        const values = current(input.type);
        if (values.includes(value.data)) {
          return invalid({ value: translate(locale, duplicateErrors[input.type]) });
        }

        await save(input.type, [...values, value.data]);
        return ok(translate(locale, successMessages[input.type].added));
      },
    },
    remove: {
      fields: { type: v.picklist(restrictionTypes), value: v.string() },
      async handler(input, { current, save }, locale) {
        const values = current(input.type);
        if (!values.includes(input.value)) {
          throw new ActionError(`This ${input.type} isn't in the list.`, 400, {
            key: missingErrors[input.type],
          });
        }

        await save(
          input.type,
          values.filter((value) => value !== input.value),
        );
        return ok(translate(locale, successMessages[input.type].removed));
      },
    },
  },
});
