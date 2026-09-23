import { api } from "@/lib/api";
import type { ApiEnvelope } from "@/types";

/*
  Admin Settings -> Privileges & Configuration. The server is the authority on
  every rule here (locked codes, self-lockout, last Super Admin); the screen
  repeats the simple ones only so it can say why before a save is attempted.
*/

export interface PermissionDefinition {
  code: string;
  module: string;
  label: string;
  description: string;
  actions: string[];
  /** False for the three codes no endpoint checks -- unticking them stops nobody. */
  enforced: boolean;
  critical: boolean;
}

export interface RolePrivilege {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  userCount: number;
  permissions: string[];
  isAdminRole: boolean;
  lockedPermissions: string[];
}

export interface PrivilegeOverview {
  historyReady: boolean;
  actorIsSuperAdmin: boolean;
  actions: string[];
  permissions: PermissionDefinition[];
  roles: RolePrivilege[];
}

export interface UserPrivilege {
  id: number;
  name: string;
  employeeCode?: string | null;
  username?: string | null;
  enabled: boolean;
  profileStatus?: string | null;
  roles: string[];
}

export interface ChangeResult {
  changeId: number | null;
  summary: string;
}

export interface ChangeLogEntry {
  id: number;
  changeType: "ROLE_PERMISSIONS" | "USER_ROLES" | "CONFIG";
  targetKey: string;
  targetLabel?: string | null;
  summary?: string | null;
  beforeJson?: string | null;
  afterJson?: string | null;
  actorName?: string | null;
  rolledBack: boolean;
  rollbackOfId?: number | null;
  createdAt: string;
}

export interface ConfigItem {
  key: string;
  group: string;
  label: string;
  description: string;
  type: "Boolean" | "Integer" | "Decimal" | "Time";
  value: string;
  defaultValue: string;
  min?: number | null;
  max?: number | null;
  stored: boolean;
}

export const SUPER_ADMIN = "SUPER_ADMIN";
export const ADMIN_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN"];

export const privilegeKeys = {
  overview: ["privileges", "overview"] as const,
  users: ["privileges", "users"] as const,
  history: ["privileges", "history"] as const,
  config: ["privileges", "config"] as const
};

const BASE = "/admin/privileges";

export const privilegesApi = {
  overview: async () =>
    (await api.get<ApiEnvelope<PrivilegeOverview>>(BASE)).data.data,
  setRolePermissions: async (roleId: number, permissions: string[]) =>
    (await api.put<ApiEnvelope<ChangeResult>>(`${BASE}/roles/${roleId}`, { permissions })).data.data,
  users: async () =>
    (await api.get<ApiEnvelope<UserPrivilege[]>>(`${BASE}/users`)).data.data,
  bulkUserRoles: async (userIds: number[], add: string[], remove: string[]) =>
    (await api.post<ApiEnvelope<ChangeResult>>(`${BASE}/users/roles`, { userIds, add, remove })).data.data,
  configuration: async () =>
    (await api.get<ApiEnvelope<ConfigItem[]>>(`${BASE}/configuration`)).data.data,
  saveConfiguration: async (values: Record<string, string>) =>
    (await api.put<ApiEnvelope<ChangeResult>>(`${BASE}/configuration`, values)).data.data,
  history: async () =>
    (await api.get<ApiEnvelope<ChangeLogEntry[]>>(`${BASE}/history`)).data.data,
  rollback: async (id: number) =>
    (await api.post<ApiEnvelope<ChangeResult>>(`${BASE}/history/${id}/rollback`)).data.data
};

/** Added and removed between two code lists, sorted -- the preview a save confirms. */
export function diffCodes(before: string[], after: string[]) {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: [...a].filter((c) => !b.has(c)).sort(),
    removed: [...b].filter((c) => !a.has(c)).sort()
  };
}

/** Role codes as people know them: IT_MGR is shown as IT_HR elsewhere in the portal. */
export function roleDisplay(code: string, name?: string | null) {
  return name && name !== code ? `${name} (${code})` : code;
}
