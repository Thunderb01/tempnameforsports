import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/styles/global.css";

import { ProtectedRoute, SuperAdminRoute } from "@/components/ProtectedRoute";

// Eagerly loaded — these are tiny and always needed
import { LandingPage }       from "@/pages/LandingPage";
import { LoginPage }         from "@/pages/LoginPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";

// Lazy-loaded — each becomes its own JS chunk, only downloaded when visited
const AppPage          = lazy(() => import("@/pages/AppPage").then(m => ({ default: m.AppPage })));
const BoardPage        = lazy(() => import("@/pages/BoardPage").then(m => ({ default: m.BoardPage })));
const AdminPage        = lazy(() => import("@/pages/AdminPage").then(m => ({ default: m.AdminPage })));
const ComparePage           = lazy(() => import("@/pages/ComparePage").then(m => ({ default: m.ComparePage })));
const PortalRankingsPage    = lazy(() => import("@/pages/PortalRankingsPage").then(m => ({ default: m.PortalRankingsPage })));
const PortalPage       = lazy(() => import("@/pages/PortalPage").then(m => ({ default: m.PortalPage })));

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          {/* Public */}
          <Route path="/"               element={<LandingPage />} />
          <Route path="/login"          element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Protected */}
          <Route element={<ProtectedRoute />}>
            <Route path="/app"     element={<AppPage />} />
            <Route path="/board"   element={<BoardPage />} />
            <Route path="/sandbox" element={<Navigate to="/app" replace />} />
            <Route path="/compare"  element={<ComparePage />} />
            <Route path="/rankings" element={<PortalRankingsPage />} />
            <Route path="/portal"   element={<PortalPage />} />
          </Route>

          {/* Superadmin only */}
          <Route element={<SuperAdminRoute />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>
);
