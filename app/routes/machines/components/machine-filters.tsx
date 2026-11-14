import { X } from "lucide-react";
import type { JSX } from "react";

import Button from "~/components/button";
import FilterDropdown from "~/components/filter-dropdown";
import { useI18n } from "~/i18n/react";
import type { User } from "~/types/User";
import type { PopulatedNode } from "~/utils/node-info";
import { getUserDisplayName, isTaggedDevicesUser, sortUsersByDisplayName } from "~/utils/user";

import { useMachineFilterParams } from "../hooks/use-machine-filter-params";

interface MachineFiltersProps {
  users: User[];
  populatedNodes: PopulatedNode[];
}

export function MachineFilters({ users, populatedNodes }: MachineFiltersProps): JSX.Element {
  const { t } = useI18n();
  const {
    filterUser,
    filterTag,
    filterStatus,
    filterRoute,
    hasActiveFilters,
    setParam,
    clearFilters,
  } = useMachineFilterParams();

  const statusOptions = [
    { value: "online", label: t("machines.status.online") },
    { value: "offline", label: t("machines.status.offline") },
    { value: "expired", label: t("machines.status.expired") },
  ];
  const routeOptions = [
    { value: "exit-node", label: t("machines.routes.exitNode") },
    { value: "subnet", label: t("machines.routes.subnetRouter") },
  ];
  const tagOwnedExists = populatedNodes.some((n) => !n.user);
  const userOptions = [
    ...(tagOwnedExists ? [{ value: "tag-owned", label: t("machines.tagOwned") }] : []),
    ...sortUsersByDisplayName(users).map((u) => ({
      value: u.name,
      label: isTaggedDevicesUser(u) ? t("machines.tagOwned") : getUserDisplayName(u),
    })),
  ];

  const tagOptions = Array.from(new Set(populatedNodes.flatMap((n) => n.tags)))
    .filter(Boolean)
    .sort()
    .map((tag) => ({ value: tag, label: tag }));

  return (
    <>
      {userOptions.length > 0 && (
        <FilterDropdown
          label={t("machines.filters.user")}
          onChange={(v) => setParam("user", v)}
          options={userOptions}
          value={filterUser}
        />
      )}
      {tagOptions.length > 0 && (
        <FilterDropdown
          label={t("machines.filters.tag")}
          onChange={(v) => setParam("tag", v)}
          options={tagOptions}
          value={filterTag}
        />
      )}
      <FilterDropdown
        label={t("machines.filters.status")}
        onChange={(v) => setParam("status", v)}
        options={statusOptions}
        value={filterStatus}
      />
      <FilterDropdown
        label={t("machines.filters.route")}
        onChange={(v) => setParam("route", v)}
        options={routeOptions}
        value={filterRoute}
      />
      {hasActiveFilters && (
        <Button onClick={clearFilters} variant="ghost">
          {t("machines.filters.clear")}
          <X className="size-3.5" />
        </Button>
      )}
    </>
  );
}
