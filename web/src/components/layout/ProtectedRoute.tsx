import { Navigate, useLocation } from "react-router-dom";
import { PixousLoader } from "@/components/ui/pixous-loader";
import { tokenStore } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();
  const location = useLocation();

  if (!tokenStore.access) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <PixousLoader size="md" />
      </div>
    );
  }

  return <>{children}</>;
}
