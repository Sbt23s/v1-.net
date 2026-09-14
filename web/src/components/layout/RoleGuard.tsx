import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/**
 * Gates content by permission(s). `permission` accepts a comma-separated
 * list — the user needs ANY one of them.
 * SUPER_ADMIN always passes through regardless of permission.
 */
export function RoleGuard({
  permission,
  role,
  denyEmployeeCodes,
  children
}: {
  permission?: string;
  /**
   * Require this role instead of a permission. Nothing bypasses it — a
   * permission grant does not open a door meant for one role only.
   */
  role?: string;
  /**
   * Named accounts refused even when the role check passes.
   *
   * Fresh Start needs this: it asks for SUPER_ADMIN, and the CTO holds
   * SUPER_ADMIN, so hiding the sidebar link left the page reachable by typing
   * the address -- on a screen that empties company data. Nothing else uses it,
   * and leaving it unset keeps the previous behaviour exactly.
   */
  denyEmployeeCodes?: string[];
  children: React.ReactNode;
}) {
  const { user, hasPermission, hasRole, hasRoleExact } = useAuth();
  const perms = (permission ?? "").split(",").map((p) => p.trim()).filter(Boolean);

  // SUPER_ADMIN and COMPANY_ADMIN bypass all permission gates.
  //
  // The `role` prop takes the exact check on purpose. It is used for doors meant
  // for one named role and nothing else — Fresh Start, which empties a portal —
  // and the aliasing that makes a company administrator equal to a super admin
  // everywhere else must not quietly hand that button to more people.
  const denied = (denyEmployeeCodes ?? []).some(
    (code) => code.toUpperCase() === (user?.employeeCode ?? "").toUpperCase()
  );

  const allowed = !denied && (role
    ? hasRoleExact(role)
    : hasRole("SUPER_ADMIN") || hasPermission(...perms));

  if (!allowed) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="h-6 w-6 text-destructive" />
        </div>
        <h2 className="font-display text-lg font-semibold">Restricted</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don't have access to this area. If you think this is a mistake, contact your HR admin.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
