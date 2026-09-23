import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RolePrivilegesPanel } from "./RolePrivilegesPanel";
import { diffCodes, type PrivilegeOverview } from "@/lib/privileges";

const { setRolePermissions, refreshUser } = vi.hoisted(() => ({
  setRolePermissions: vi.fn(),
  refreshUser: vi.fn()
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 10, roles: ["SUPER_ADMIN"] }, refreshUser })
}));

vi.mock("@/lib/privileges", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/privileges")>();
  return { ...actual, privilegesApi: { ...actual.privilegesApi, setRolePermissions } };
});

const perms = [
  { code: "USER_MANAGE", module: "Employees", label: "Full employee administration", description: "", actions: ["View All", "Create"], enforced: true, critical: true },
  { code: "ORG_MANAGE", module: "Organization", label: "Organization setup", description: "", actions: ["Configure"], enforced: true, critical: true },
  { code: "LEAVE_APPROVE", module: "Leave", label: "Approve leave & permission", description: "", actions: ["Approve"], enforced: true, critical: false },
  { code: "LEAVE_APPLY", module: "Leave", label: "Apply for leave", description: "", actions: ["Create"], enforced: false, critical: false }
];

function overview(overrides: Partial<PrivilegeOverview> = {}): PrivilegeOverview {
  return {
    historyReady: true,
    actorIsSuperAdmin: true,
    actions: ["View All", "Create", "Approve", "Configure"],
    permissions: perms,
    roles: [
      { id: 1, code: "SUPER_ADMIN", name: "Super Admin", userCount: 2, permissions: ["ORG_MANAGE", "USER_MANAGE"],
        isAdminRole: true, lockedPermissions: ["ORG_MANAGE", "USER_MANAGE"] },
      { id: 4, code: "IT_EMP", name: "Employee", userCount: 30, permissions: ["LEAVE_APPLY"],
        isAdminRole: false, lockedPermissions: [] }
    ],
    ...overrides
  };
}

function renderPanel(o = overview()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RolePrivilegesPanel overview={o} />
    </QueryClientProvider>
  );
}

describe("RolePrivilegesPanel", () => {
  beforeEach(() => {
    setRolePermissions.mockReset();
    refreshUser.mockReset();
  });

  it("locks the admin role's protected codes", () => {
    renderPanel();
    expect(screen.getByRole("switch", { name: /revoke USER_MANAGE/i })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /revoke ORG_MANAGE/i })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /grant LEAVE_APPROVE/i })).toBeEnabled();
  });

  it("flags codes that no endpoint enforces", () => {
    renderPanel();
    expect(screen.getAllByText("Not enforced")).toHaveLength(1);
  });

  it("stages a change, confirms it, and saves exactly the new set", async () => {
    setRolePermissions.mockResolvedValue({ changeId: 7, summary: "IT_EMP: +LEAVE_APPROVE" });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /IT_EMP/ }));
    await user.click(screen.getByRole("switch", { name: /grant LEAVE_APPROVE/i }));

    expect(screen.getByText(/1 unsaved change/)).toBeInTheDocument();
    expect(setRolePermissions).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /review & save/i }));
    expect(await screen.findByText(/Save privileges for IT_EMP/)).toBeInTheDocument();
    expect(screen.getByText("Approve leave & permission (LEAVE_APPROVE)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(setRolePermissions).toHaveBeenCalledTimes(1));
    const [roleId, codes] = setRolePermissions.mock.calls[0];
    expect(roleId).toBe(4);
    expect([...codes].sort()).toEqual(["LEAVE_APPLY", "LEAVE_APPROVE"]);
  });

  it("discard returns to what the server holds", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /IT_EMP/ }));
    await user.click(screen.getByRole("switch", { name: /grant LEAVE_APPROVE/i }));
    await user.click(screen.getByRole("button", { name: /discard/i }));
    expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument();
  });

  it("is read-only until the history migration is applied", () => {
    renderPanel(overview({ historyReady: false }));
    screen.getAllByRole("switch").forEach((s) => expect(s).toBeDisabled());
  });

  it("is read-only on SUPER_ADMIN for a company admin", () => {
    renderPanel(overview({ actorIsSuperAdmin: false }));
    expect(screen.getByText(/Only a Super Admin can change the Super Admin role/)).toBeInTheDocument();
    screen.getAllByRole("switch").forEach((s) => expect(s).toBeDisabled());
  });
});

describe("diffCodes", () => {
  it("lists what was added and removed", () => {
    expect(diffCodes(["A", "B"], ["B", "C"])).toEqual({ added: ["C"], removed: ["A"] });
    expect(diffCodes(["A"], ["A"])).toEqual({ added: [], removed: [] });
  });
});
