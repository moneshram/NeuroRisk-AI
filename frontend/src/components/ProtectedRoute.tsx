import { Navigate, Outlet } from "react-router-dom";
import { getUser } from "../lib/api";

export function ProtectedRoute({ role }: { role?: "user" | "admin" }) {
  const user = getUser();

  // Not authenticated
  if (!user) {
    return (
      <Navigate to={role === "admin" ? "/admin-login" : "/login"} replace />
    );
  }

  // Authenticated but wrong role
  if (role && user.role !== role) {
    return (
      <Navigate to={role === "admin" ? "/admin-login" : "/login"} replace />
    );
  }

  return <Outlet />;
}
