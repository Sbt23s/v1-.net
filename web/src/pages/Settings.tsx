import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import {
  SlidersHorizontal, Palette, Megaphone,
  Users, Bot, History, Eraser, KeyRound, Wrench
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

import { SettingsModulesTab } from "@/pages/settings/SettingsModulesTab";
import { SettingsBrandingTab } from "@/pages/settings/SettingsBrandingTab";
import { SettingsAnnouncementsTab } from "@/pages/settings/SettingsAnnouncementsTab";
import { SettingsUsersRolesTab } from "@/pages/settings/SettingsUsersRolesTab";
import { SettingsAiChatbotTab } from "@/pages/settings/SettingsAiChatbotTab";
import { SettingsAuditSecurityTab } from "@/pages/settings/SettingsAuditSecurityTab";
import { SettingsResetTab } from "@/pages/settings/SettingsResetTab";
import { SettingsPrivilegesTab } from "@/pages/settings/SettingsPrivilegesTab";
import { SettingsConfigurationTab } from "@/pages/settings/SettingsConfigurationTab";

type SettingsTabKey =
  | "privileges"
  | "configuration"
  | "modules"
  | "branding"
  | "announcements"
  | "users"
  | "ai"
  | "audit"
  | "reset";

interface TabDefinition {
  key: SettingsTabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const SETTINGS_TABS: TabDefinition[] = [
  {
    key: "privileges",
    label: "Privileges",
    icon: KeyRound,
    description: "Role permissions, user roles, change history and rollback"
  },
  {
    key: "configuration",
    label: "Configuration",
    icon: Wrench,
    description: "Reminders, retention and claim rates the modules read"
  },
  {
    key: "modules",
    label: "Module Management",
    icon: SlidersHorizontal,
    description: "Feature switches and role visibility controls"
  },
  {
    key: "branding",
    label: "Branding & Appearance",
    icon: Palette,
    description: "Themes, brand colors, typography and live preview"
  },
  {
    key: "announcements",
    label: "Global Announcements",
    icon: Megaphone,
    description: "Login popups, greeting banners and multimedia broadcasts"
  },
  {
    key: "users",
    label: "Users & Roles",
    icon: Users,
    description: "Administrators, staff accounts and platform role directory"
  },
  {
    key: "ai",
    label: "AI Chatbot & Integrations",
    icon: Bot,
    description: "LLM providers, ElevenLabs voice keys and crawler"
  },
  {
    key: "audit",
    label: "Audit Logs & Security",
    icon: History,
    description: "Technical audit trails, telemetry and security rules"
  },
  {
    key: "reset",
    label: "Fresh Start",
    icon: Eraser,
    description: "Reset transactional test records while keeping master data"
  }
];

/** The CTO account is kept out of Fresh Start at /admin/reset; the tab here must not be a way round that. */
const RESET_DENIED_CODES = ["PIX-E100"];

export default function SettingsPage() {
  const { user } = useAuth();
  const resetDenied = RESET_DENIED_CODES.includes((user?.employeeCode ?? "").toUpperCase());
  const tabs = SETTINGS_TABS.filter((t) => !(t.key === "reset" && resetDenied));

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as SettingsTabKey) || "modules";

  const [activeTab, setActiveTab] = useState<SettingsTabKey>(
    tabs.some((t) => t.key === initialTab) ? initialTab : "modules"
  );

  useEffect(() => {
    const tabParam = searchParams.get("tab") as SettingsTabKey;
    if (tabParam && tabs.some((t) => t.key === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams, resetDenied]);

  const handleSelectTab = (key: SettingsTabKey) => {
    setActiveTab(key);
    setSearchParams({ tab: key });
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Settings"
        subtitle="System administration, modules, branding, announcements, and platform preferences for Pixous Technologies."
      />

      {/* Navigation Tab Bar */}
      <div className="border-b border-border">
        <nav className="flex space-x-2 overflow-x-auto pb-2 scrollbar-none" aria-label="Settings Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleSelectTab(tab.key)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Active Tab Panel */}
      <div className="pt-1">
        {activeTab === "privileges" && <SettingsPrivilegesTab />}
        {activeTab === "configuration" && <SettingsConfigurationTab />}
        {activeTab === "modules" && <SettingsModulesTab />}
        {activeTab === "branding" && <SettingsBrandingTab />}
        {activeTab === "announcements" && <SettingsAnnouncementsTab />}
        {activeTab === "users" && <SettingsUsersRolesTab />}
        {activeTab === "ai" && <SettingsAiChatbotTab />}
        {activeTab === "audit" && <SettingsAuditSecurityTab />}
        {activeTab === "reset" && !resetDenied && <SettingsResetTab />}
      </div>
    </div>
  );
}
