import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/styles/global.css";

import { LandingPage }      from "@/pages/LandingPage";
import { LoginPage }        from "@/pages/LoginPage";
import { ResetPasswordPage }from "@/pages/ResetPasswordPage";
import { AppPage }             from "@/pages/AppPage";
import { BoardPage }           from "@/pages/BoardPage";
import { RosterSandboxPage }   from "@/pages/RosterSandboxPage";
import { ProtectedRoute, SuperAdminRoute } from "@/components/ProtectedRoute";
import { AdminPage }          from "@/pages/AdminPage";
import { ComparePage }        from "@/pages/ComparePage";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/"               element={<LandingPage />} />
        <Route path="/login"          element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Protected */}
        <Route element={<ProtectedRoute />}>
          <Route path="/app"     element={<AppPage />} />
          <Route path="/board"   element={<BoardPage />} />
          <Route path="/sandbox" element={<RosterSandboxPage />} />
          <Route path="/compare" element={<ComparePage />} />
        </Route>

        {/* Superadmin only */}
        <Route element={<SuperAdminRoute />}>
          <Route path="/admin" element={<AdminPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
