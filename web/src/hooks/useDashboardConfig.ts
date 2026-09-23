import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import {
  type DashboardGeneralConfig,
  type RoleDashboardConfig,
  type WidgetConfig,
  type DataScope,
  loadDashboardConfig,
  buildDefaultRoleConfig,
  DEFAULT_GENERAL,
} from "@/lib/dashboard-config";

export function getEffectiveRole(roles?: string[], employeeCode?: string): string {
  if (employeeCode === "PIX-E100") return "COMPANY_ADMIN"; // CTO
  if (!roles || roles.length === 0) return "EMPLOYEE";
  if (roles.some((r) => ["SUPER_ADMIN", "COMPANY_ADMIN", "BOARD_ADMIN"].includes(r))) {
    return "COMPANY_ADMIN";
  }
  if (roles.some((r) => ["HR_MANAGER", "IT_HR", "CV_HR", "IT_MGR"].includes(r))) {
    return "HR_MANAGER";
  }
  if (roles.some((r) => ["TEAM_LEAD", "IT_TL", "CV_SUP"].includes(r))) {
    return "TEAM_LEAD";
  }
  return "EMPLOYEE";
}

export function useDashboardConfig(options?: {
  overrideRole?: string;
  overrideGeneral?: DashboardGeneralConfig;
  overrideRoleConfig?: RoleDashboardConfig;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [localVersion, setLocalVersion] = useState(0);

  const effectiveRole = useMemo(
    () => options?.overrideRole || getEffectiveRole(user?.roles, user?.employeeCode),
    [options?.overrideRole, user?.roles, user?.employeeCode]
  );

  useEffect(() => {
    const onUpdate = () => {
      setLocalVersion((v) => v + 1);
      queryClient.invalidateQueries({ queryKey: ["dashboard-config"] });
    };
    window.addEventListener("hrp_dashboard_config_updated", onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener("hrp_dashboard_config_updated", onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, [queryClient]);

  // Fetch from server with fallback to localStorage
  const { data: serverConfig } = useQuery({
    queryKey: ["dashboard-config", "my-config", effectiveRole, localVersion],
    queryFn: async () => {
      try {
        const res = await api.get("/dashboard-config/my-config");
        return res.data?.data;
      } catch {
        return null;
      }
    },
    staleTime: 10_000,
    retry: false,
    enabled: !options?.overrideRoleConfig,
  });

  const localFull = useMemo(() => loadDashboardConfig(), [localVersion]);

  const general: DashboardGeneralConfig = useMemo(() => {
    if (options?.overrideGeneral) return options.overrideGeneral;
    if (serverConfig?.general) return serverConfig.general;
    return localFull.general || DEFAULT_GENERAL;
  }, [options?.overrideGeneral, serverConfig, localFull]);

  const roleConfig: RoleDashboardConfig = useMemo(() => {
    if (options?.overrideRoleConfig) return options.overrideRoleConfig;
    if (serverConfig?.roleConfig && serverConfig.roleConfig.roleCode === effectiveRole) {
      return serverConfig.roleConfig;
    }
    return localFull.roles[effectiveRole] || buildDefaultRoleConfig(effectiveRole);
  }, [options?.overrideRoleConfig, serverConfig, localFull, effectiveRole]);

  // Widget lookup map
  const widgetMap = useMemo(() => {
    const map = new Map<string, WidgetConfig>();
    for (const w of roleConfig.widgets || []) {
      map.set(w.code, w);
    }
    return map;
  }, [roleConfig.widgets]);

  const isWidgetEnabled = (code: string): boolean => {
    const w = widgetMap.get(code);
    return w ? w.enabled : true;
  };

  const isWidgetVisible = (code: string): boolean => {
    const w = widgetMap.get(code);
    return w ? w.enabled && w.visible : true;
  };

  const getWidgetScope = (code: string): DataScope => {
    const w = widgetMap.get(code);
    return w ? w.dataScope : "OWN";
  };

  const isActionEnabled = (actionCode: string): boolean => {
    const a = roleConfig.quickActions?.find((x) => x.code === actionCode);
    return a ? a.enabled : true;
  };

  const hasScope = (scope: DataScope): boolean => {
    const p = roleConfig.permissions;
    if (!p) return scope === "OWN";
    switch (scope) {
      case "OWN": return p.scopeOwn;
      case "TEAM": return p.scopeTeam;
      case "DEPARTMENT": return p.scopeDepartment;
      case "ORGANIZATION": return p.scopeOrganization;
      case "EXECUTIVE": return p.scopeExecutive;
      case "ALL": return p.scopeOrganization || p.scopeExecutive;
      default: return true;
    }
  };

  return {
    effectiveRole,
    general,
    roleConfig,
    isWidgetEnabled,
    isWidgetVisible,
    getWidgetScope,
    isActionEnabled,
    hasScope,
    canExport: roleConfig.permissions?.canExport ?? false,
    canViewAnalytics: roleConfig.permissions?.canViewAnalytics ?? true,
    canViewManagement: roleConfig.permissions?.canViewManagement ?? false,
    canViewExecutive: roleConfig.permissions?.canViewExecutive ?? false,
  };
}
