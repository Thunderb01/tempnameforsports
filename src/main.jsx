import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/styles/global.css";

import { ProtectedRoute, SuperAdminRoute, AdminRoute } from "@/components/ProtectedRoute";

// Eagerly loaded — these are tiny and always needed
import { LandingPage }       from "@/pages/LandingPage";
import { LoginPage }         from "@/pages/LoginPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { FAQPage }           from "@/pages/FAQPage";

// Lazy-loaded — each becomes its own JS chunk, only downloaded when visited
const AppPage          = lazy(() => import("@/pages/AppPage").then(m => ({ default: m.AppPage })));
const BoardPage        = lazy(() => import("@/pages/BoardPage").then(m => ({ default: m.BoardPage })));
const AdminPage        = lazy(() => import("@/pages/AdminPage").then(m => ({ default: m.AdminPage })));
const InternationalAdminPage = lazy(() => import("@/pages/InternationalAdminPage").then(m => ({ default: m.InternationalAdminPage })));
const ComparePage           = lazy(() => import("@/pages/ComparePage").then(m => ({ default: m.ComparePage })));
const PortalRankingsPage    = lazy(() => import("@/pages/PortalRankingsPage").then(m => ({ default: m.PortalRankingsPage })));
const PortalPage            = lazy(() => import("@/pages/PortalPage").then(m => ({ default: m.PortalPage })));
const InternationalPage     = lazy(() => import("@/pages/InternationalPage").then(m => ({ default: m.InternationalPage })));

// ── Women's pages ────────────────────────────────────────────────────────────
// Mirror men's pages 1:1 in shape; each is a fork that queries `w_*` tables
// and uses the women's scoring config. Build them out alongside men's, not as
// shared code with a toggle.
const WomensAppPage              = lazy(() => import("@/pages/womens/AppPage").then(m => ({ default: m.WomensAppPage })));
const WomensBoardPage            = lazy(() => import("@/pages/womens/BoardPage").then(m => ({ default: m.WomensBoardPage })));
const WomensComparePage          = lazy(() => import("@/pages/womens/ComparePage").then(m => ({ default: m.WomensComparePage })));
const WomensPortalRankingsPage   = lazy(() => import("@/pages/womens/PortalRankingsPage").then(m => ({ default: m.WomensPortalRankingsPage })));
const WomensInternationalPage    = lazy(() => import("@/pages/womens/InternationalPage").then(m => ({ default: m.WomensInternationalPage })));

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          {/* Public */}
          <Route path="/"               element={<LandingPage />} />
          <Route path="/faq"            element={<FAQPage />} />
          <Route path="/login"          element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Protected */}
          <Route element={<ProtectedRoute />}>
            <Route path="/app"     element={<AppPage />} />
            <Route path="/board"   element={<BoardPage />} />
            <Route path="/sandbox" element={<Navigate to="/app" replace />} />
            <Route path="/compare"  element={<ComparePage />} />
            <Route path="/rankings" element={<PortalRankingsPage />} />
            <Route path="/portal"        element={<PortalPage />} />
            <Route path="/international" element={<InternationalPage />} />
          </Route>

          {/* Women's — admin-only. Non-admins hitting /w/* get bounced to /app. */}
          <Route element={<AdminRoute />}>
            <Route path="/w/app"           element={<WomensAppPage />} />
            <Route path="/w/board"         element={<WomensBoardPage />} />
            <Route path="/w/compare"       element={<WomensComparePage />} />
            <Route path="/w/rankings"      element={<WomensPortalRankingsPage />} />
            <Route path="/w/international" element={<WomensInternationalPage />} />
          </Route>

          {/* Superadmin only */}
          <Route element={<SuperAdminRoute />}>
            <Route path="/admin"               element={<AdminPage />} />
            <Route path="/admin/international" element={<InternationalAdminPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>
);
