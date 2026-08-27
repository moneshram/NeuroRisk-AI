import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Register from "./pages/Register";
import AdminLogin from "./pages/AdminLogin";
import Assessment from "./pages/Assessment";
import AssessmentHistory from "./pages/AssessmentHistory";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import AccountEmailSettings from "./pages/AccountEmailSettings";
import AccountPasswordSettings from "./pages/AccountPasswordSettings";
import AdminSettings from "./pages/AdminSettings";
import AdminEmailSettings from "./pages/AdminEmailSettings";
import AdminPasswordSettings from "./pages/AdminPasswordSettings";
import Results from "./pages/Results";
import Admin from "./pages/Admin";
import { initializeTheme } from "./lib/theme";

export default function App() {
  const location = useLocation();
  useEffect(() => {
    initializeTheme();
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/register" element={<Register />} />
      <Route path="/admin-login" element={<AdminLogin />} />
      <Route element={<ProtectedRoute role="user" />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/assessments" element={<AssessmentHistory />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/email" element={<AccountEmailSettings />} />
        <Route path="/settings/password" element={<AccountPasswordSettings />} />
        <Route path="/" element={<Assessment />} />
        <Route path="/results" element={<Results />} />
      </Route>
      <Route element={<ProtectedRoute role="admin" />}>
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="/admin/settings/email" element={<AdminEmailSettings />} />
        <Route path="/admin/settings/password" element={<AdminPasswordSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
