import { en as actionsEn, zhCN as actionsZhCN } from "./messages/actions";
import { en as authEn, zhCN as authZhCN } from "./messages/auth";
import { en as commonEn, zhCN as commonZhCN } from "./messages/common";
import { en as componentsEn, zhCN as componentsZhCN } from "./messages/components";
import { en as dnsEn, zhCN as dnsZhCN } from "./messages/dns";
import { en as errorsEn, zhCN as errorsZhCN } from "./messages/errors";
import { en as machinesEn, zhCN as machinesZhCN } from "./messages/machines";
import { en as networkEn, zhCN as networkZhCN } from "./messages/network";
import { en as policyEn, zhCN as policyZhCN } from "./messages/policy";
import { en as settingsEn, zhCN as settingsZhCN } from "./messages/settings";
import { en as sshEn, zhCN as sshZhCN } from "./messages/ssh";
import { en as usersEn, zhCN as usersZhCN } from "./messages/users";

export const english = {
  ...actionsEn,
  ...authEn,
  ...commonEn,
  ...componentsEn,
  ...dnsEn,
  ...errorsEn,
  ...machinesEn,
  ...networkEn,
  ...policyEn,
  ...settingsEn,
  ...sshEn,
  ...usersEn,
};
export const chinese: Partial<Record<keyof typeof english, string>> = {
  ...actionsZhCN,
  ...authZhCN,
  ...commonZhCN,
  ...componentsZhCN,
  ...dnsZhCN,
  ...errorsZhCN,
  ...machinesZhCN,
  ...networkZhCN,
  ...policyZhCN,
  ...settingsZhCN,
  ...sshZhCN,
  ...usersZhCN,
};
