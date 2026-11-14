import * as v from "valibot";

import { translate } from "~/i18n";
import { authContext, headscaleLiveStoreContext, requestApiContext } from "~/server/context";
import type { HeadscaleClient } from "~/server/headscale/api";
import { isDataWithApiError } from "~/server/headscale/api/error-client";
import { usersResource } from "~/server/headscale/live-store";
import { ActionError, createAction } from "~/server/web/actions";
import { type AuthService, isUserPrincipal } from "~/server/web/auth";
import { Capabilities, Roles, type Role } from "~/server/web/roles";
import { isValidGroupName, parsePolicy, serializePolicy, setUserGroups } from "~/utils/acl-policy";
import { invalid, list, ok } from "~/utils/form";

import { username } from "./schemas";

const id = v.pipe(v.string(), v.minLength(1));
const optionalText = v.pipe(
  v.optional(v.string(), ""),
  v.trim(),
  v.transform((value) => value || undefined),
);

const assignableRoles = Object.keys(Roles).filter((role) => role !== "owner") as Exclude<
  Role,
  "owner"
>[];

export const userAction = createAction({
  capability: Capabilities.write_users,
  async setup({ request, context }) {
    const { principal, api } = await context.get(requestApiContext)(request);
    const liveStore = context.get(headscaleLiveStoreContext);

    return {
      principal,
      api,
      auth: context.get(authContext),
      refresh: () => liveStore.refresh(usersResource, api),
    };
  },
  intents: {
    create: {
      fields: { name: username, display_name: optionalText, email: optionalText },
      async handler(input, { api, refresh }, locale) {
        await requireFreeName(api, input.name);
        await api.users.create({
          name: input.name,
          displayName: input.display_name,
          email: input.email,
        });
        await refresh();
        return ok(translate(locale, "actions.userCreated"));
      },
    },
    delete: {
      fields: { headscale_user_id: id },
      auditTarget: "headscale_user_id",
      async handler(input, { api, auth, refresh }, locale) {
        await api.users.delete(input.headscale_user_id);
        for (const user of await auth.listUsers()) {
          if (user.headscale_user_id === input.headscale_user_id) {
            await auth.unlinkHeadscaleUser(user.id);
          }
        }

        await refresh();
        return ok(translate(locale, "actions.userDeleted"));
      },
    },
    rename: {
      fields: { headscale_user_id: id, name: username },
      auditTarget: "headscale_user_id",
      async handler(input, { api, refresh }, locale) {
        const users = await api.users.list({ id: input.headscale_user_id });
        const user = users.find((user) => user.id === input.headscale_user_id);
        if (!user) {
          throw new ActionError("This user no longer exists.", 404, { key: "errors.userMissing" });
        }

        if (user.provider === "oidc") {
          throw new ActionError("Users managed by OIDC can't be renamed.", 403, {
            key: "errors.oidcRenameDenied",
          });
        }

        await requireFreeName(api, input.name);
        await api.users.rename(user.id, input.name);
        await refresh();
        return ok(translate(locale, "actions.userRenamed"));
      },
    },
    reassign: {
      fields: { headplane_user_id: id, role: v.picklist(assignableRoles, "Choose a role.") },
      auditTarget: "headplane_user_id",
      async handler(input, { auth }, locale) {
        const user = await requireHeadplaneUser(auth, input.headplane_user_id);
        if (user.role === "owner") {
          throw new ActionError("Transfer ownership to change the owner's role.", 403, {
            key: "errors.ownerRoleTransfer",
          });
        }

        if (!(await auth.reassignUser(user.id, input.role))) {
          throw new ActionError("Couldn't change the role. Try again.", 500, {
            key: "errors.roleChangeFailed",
          });
        }

        return ok(translate(locale, "actions.roleChanged"));
      },
    },
    transfer: {
      fields: { headplane_user_id: id },
      auditTarget: "headplane_user_id",
      async handler(input, { auth, principal }, locale) {
        if (!isUserPrincipal(principal) || principal.user.role !== "owner") {
          throw new ActionError("Only the owner can transfer ownership.", 403, {
            key: "errors.ownerOnlyTransfer",
          });
        }

        const target = await requireHeadplaneUser(auth, input.headplane_user_id);
        if (target.id === principal.user.id) {
          throw new ActionError("You already own Headplane.", 400, { key: "errors.alreadyOwner" });
        }

        if (!(await auth.transferOwnership(principal.user.id, input.headplane_user_id))) {
          throw new ActionError("Couldn't transfer ownership. Try again.", 500, {
            key: "errors.ownershipTransferFailed",
          });
        }

        return ok(translate(locale, "actions.ownershipTransferred"));
      },
    },
    link: {
      fields: {
        headplane_user_id: id,
        headscale_user_id: v.pipe(v.string(), v.minLength(1, "Choose a Headscale user.")),
      },
      auditTarget: "headplane_user_id",
      async handler(input, { api, auth }, locale) {
        const user = await requireHeadplaneUser(auth, input.headplane_user_id);
        const [headscaleUser] = await api.users.list({ id: input.headscale_user_id });
        if (headscaleUser?.id !== input.headscale_user_id) {
          throw new ActionError("That Headscale user no longer exists.", 404, {
            key: "errors.headscaleUserMissing",
          });
        }

        if (!(await auth.linkHeadscaleUser(user.id, headscaleUser.id))) {
          throw new ActionError("That Headscale user is already linked to another account.", 409, {
            key: "errors.headscaleUserLinked",
          });
        }

        return ok(translate(locale, "actions.headscaleUserLinked"));
      },
    },
    update_groups: {
      // Group membership lives in the policy, so `write_policy` is needed too.
      capability: Capabilities.write_policy,
      fields: { user_name: id, groups: list() },
      async handler(input, { api }, locale) {
        const groups = input.groups.map((group) => group.trim()).filter((group) => group !== "");
        const invalidGroups = groups.filter((group) => !isValidGroupName(group));
        if (invalidGroups.length > 0) {
          return invalid({
            form: translate(locale, "errors.invalidGroups", { names: invalidGroups.join(", ") }),
          });
        }

        const { policy } = await api.policy.get();
        const parsed = parsePolicy(policy);
        if (!parsed.ok) {
          throw new ActionError(`The ACL policy couldn't be parsed: ${parsed.error}`, 400, {
            key: "errors.policyParse",
            values: { detail: parsed.error },
          });
        }

        try {
          await api.policy.set(
            serializePolicy(setUserGroups(parsed.policy, input.user_name, groups)),
          );
        } catch (error) {
          // Headscale refuses policy writes in `file` mode. The UI hides group
          // editing then, but a stale page can still get here.
          if (isDataWithApiError(error) && error.data.rawData.includes("update is disabled")) {
            throw new ActionError(
              "The ACL policy is read-only. Set `policy.mode` to `database` in your Headscale configuration to edit groups.",
              403,
              { key: "errors.groupsReadOnly" },
            );
          }

          throw error;
        }

        return ok(translate(locale, "actions.groupsUpdated"));
      },
    },
  },
});

async function requireFreeName(api: HeadscaleClient, name: string) {
  const [existing] = await api.users.list({ name });
  if (existing?.name === name) {
    throw new ActionError(`A user named ${name} already exists.`, 409, {
      key: "errors.userExists",
      values: { name },
    });
  }
}

async function requireHeadplaneUser(auth: AuthService, id: string) {
  const user = (await auth.listUsers()).find((user) => user.id === id);
  if (!user) {
    throw new ActionError("This user no longer exists.", 404, { key: "errors.userMissing" });
  }

  return user;
}
