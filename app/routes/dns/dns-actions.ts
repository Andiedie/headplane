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

import { moveItem } from "./reorder";
import { nameserver, recordValue } from "./schemas";

const text = (message: string) => v.pipe(v.string(), v.trim(), v.nonEmpty(message));
const toggle = v.picklist(["true", "false"]);

// Empty means the global nameservers rather than a split DNS domain.
const splitDomain = v.pipe(
  v.optional(v.string(), ""),
  v.trim(),
  v.transform((value) => value || undefined),
);

function nameserverPath(split?: string) {
  return split ? `dns.nameservers.split."${split}"` : "dns.nameservers.global";
}

export const dnsAction = createAction({
  capability: Capabilities.write_network,
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

    return {
      principal,
      config,
      dns: config.getDNSConfig(),
      restart: async () => {
        if (integration && !(await integration.onConfigChange(headscale))) {
          throw new ActionError(
            "Saved, but Headscale didn't come back after restarting. Check its logs.",
            502,
            { key: "errors.restartFailed" },
          );
        }
      },
    };
  },
  intents: {
    rename_tailnet: {
      fields: { name: text("Enter a tailnet name.") },
      async handler(input, { config, restart }, locale) {
        await config.patch([{ path: "dns.base_domain", value: input.name }]);
        await restart();
        return ok(translate(locale, "actions.tailnetRenamed"));
      },
    },
    toggle_magic: {
      fields: { enabled: toggle },
      async handler(input, { config, restart }, locale) {
        const isEnabled = input.enabled === "true";
        await config.patch([{ path: "dns.magic_dns", value: isEnabled }]);
        await restart();
        return ok(
          translate(locale, isEnabled ? "actions.magicDnsEnabled" : "actions.magicDnsDisabled"),
        );
      },
    },
    override_dns: {
      fields: { enabled: toggle },
      async handler(input, { config, dns, restart }, locale) {
        const isEnabled = input.enabled === "true";
        // Headscale won't start overriding local DNS without a global nameserver.
        if (isEnabled && dns.nameservers.length === 0) {
          throw new ActionError("Add a global nameserver before overriding local DNS.", 400, {
            key: "errors.globalNameserverRequired",
          });
        }

        await config.patch([{ path: "dns.override_local_dns", value: isEnabled }]);
        await restart();
        return ok(translate(locale, "actions.dnsOverrideUpdated"));
      },
    },
    add_ns: {
      fields: { nameserver, split_domain: splitDomain },
      async handler(input, { config, dns, restart }, locale) {
        const servers = input.split_domain
          ? (dns.splitDns[input.split_domain] ?? [])
          : dns.nameservers;
        if (servers.includes(input.nameserver)) {
          return invalid({ nameserver: translate(locale, "errors.nameserverExists") });
        }

        await config.patch([
          { path: nameserverPath(input.split_domain), value: [...servers, input.nameserver] },
        ]);
        await restart();
        return ok(translate(locale, "actions.nameserverAdded"));
      },
    },
    remove_ns: {
      fields: { nameserver: v.string(), split_domain: splitDomain },
      async handler(input, { config, dns, restart }, locale) {
        const current = input.split_domain
          ? (dns.splitDns[input.split_domain] ?? [])
          : dns.nameservers;
        if (!current.includes(input.nameserver)) {
          throw new ActionError("This nameserver isn't in the list anymore.", 400, {
            key: "errors.nameserverMissing",
          });
        }

        const servers = current.filter((server) => server !== input.nameserver);

        if (!input.split_domain && servers.length === 0 && dns.overrideDns) {
          throw new ActionError(
            "Overriding local DNS needs a global nameserver. Turn off the override first.",
            400,
            { key: "errors.disableOverrideFirst" },
          );
        }

        // An empty split list is dropped so Headscale doesn't keep the domain.
        await config.patch([
          {
            path: nameserverPath(input.split_domain),
            value: input.split_domain && servers.length === 0 ? null : servers,
          },
        ]);
        await restart();
        return ok(translate(locale, "actions.nameserverRemoved"));
      },
    },
    move_ns: {
      fields: {
        nameserver: v.string(),
        split_domain: splitDomain,
        direction: v.picklist(["up", "down"]),
      },
      async handler(input, { config, dns, restart }) {
        const servers = input.split_domain
          ? (dns.splitDns[input.split_domain] ?? [])
          : dns.nameservers;
        if (!servers.includes(input.nameserver)) {
          throw new ActionError("This nameserver isn't in the list anymore.", 400, {
            key: "errors.nameserverMissing",
          });
        }

        // moveItem hands back the same list when there's nowhere to move.
        const moved = moveItem(servers, input.nameserver, input.direction);
        if (moved === servers) {
          throw new ActionError(
            `This nameserver is already at the ${input.direction === "up" ? "top" : "bottom"}.`,
            400,
            {
              key:
                input.direction === "up" ? "errors.nameserverAtTop" : "errors.nameserverAtBottom",
            },
          );
        }

        await config.patch([{ path: nameserverPath(input.split_domain), value: moved }]);
        await restart();
        return ok();
      },
    },
    add_domain: {
      fields: { domain: text("Enter a search domain.") },
      async handler(input, { config, dns, restart }, locale) {
        if (dns.searchDomains.includes(input.domain)) {
          return invalid({ domain: translate(locale, "errors.searchDomainExists") });
        }

        await config.patch([
          { path: "dns.search_domains", value: [...dns.searchDomains, input.domain] },
        ]);
        await restart();
        return ok(translate(locale, "actions.searchDomainAdded"));
      },
    },
    remove_domain: {
      fields: { domain: v.string() },
      async handler(input, { config, dns, restart }, locale) {
        if (!dns.searchDomains.includes(input.domain)) {
          throw new ActionError("This search domain isn't in the list anymore.", 400, {
            key: "errors.searchDomainMissing",
          });
        }

        await config.patch([
          {
            path: "dns.search_domains",
            value: dns.searchDomains.filter((domain) => domain !== input.domain),
          },
        ]);
        await restart();
        return ok(translate(locale, "actions.searchDomainRemoved"));
      },
    },
    move_domain: {
      fields: { domain: v.string(), direction: v.picklist(["up", "down"]) },
      async handler(input, { config, dns, restart }) {
        if (!dns.searchDomains.includes(input.domain)) {
          throw new ActionError("This search domain isn't in the list anymore.", 400, {
            key: "errors.searchDomainMissing",
          });
        }

        const moved = moveItem(dns.searchDomains, input.domain, input.direction);
        if (moved === dns.searchDomains) {
          throw new ActionError(
            `This search domain is already at the ${input.direction === "up" ? "top" : "bottom"}.`,
            400,
            {
              key:
                input.direction === "up"
                  ? "errors.searchDomainAtTop"
                  : "errors.searchDomainAtBottom",
            },
          );
        }

        await config.patch([{ path: "dns.search_domains", value: moved }]);
        await restart();
        return ok();
      },
    },
    add_record: {
      fields: {
        type: v.picklist(["A", "AAAA"], "Choose a record type."),
        name: text("Enter a domain."),
        value: v.string(),
      },
      async handler(input, { config, dns }, locale) {
        if (!config.recordsWritable()) {
          throw new ActionError(
            "DNS records can only be changed through dns.extra_records_path.",
            403,
            { key: "errors.recordsReadOnly" },
          );
        }

        const value = parseValues(recordValue[input.type], input.value);
        if (!value.ok) {
          return invalid(translateValidationErrors(locale, { value: value.errors.form }));
        }

        if (dns.extraRecords.some((r) => r.name === input.name && r.type === input.type)) {
          return invalid({ name: translate(locale, "errors.recordExists", { type: input.type }) });
        }

        await config.addDNS({ name: input.name, type: input.type, value: value.data });
        return ok(translate(locale, "actions.recordAdded"));
      },
    },
    remove_record: {
      fields: { type: v.string(), name: v.string() },
      async handler(input, { config, dns }, locale) {
        if (!config.recordsWritable()) {
          throw new ActionError(
            "DNS records can only be changed through dns.extra_records_path.",
            403,
            { key: "errors.recordsReadOnly" },
          );
        }

        if (!dns.extraRecords.some((r) => r.name === input.name && r.type === input.type)) {
          throw new ActionError("This record isn't in the list anymore.", 400, {
            key: "errors.recordMissing",
          });
        }

        await config.removeDNS({ name: input.name, type: input.type, value: "" });
        return ok(translate(locale, "actions.recordRemoved"));
      },
    },
  },
});
