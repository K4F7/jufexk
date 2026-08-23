import { RouterProvider } from "@heroui/react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useHref,
  useNavigate,
} from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AdminSessionProvider } from "./hooks/useAdminSession";
import { ViewerProvider } from "./hooks/useViewer";
import { api } from "./lib/api";
import type { SiteConfig } from "./lib/types";
import type { SiteBanner } from "./site-banner";
import { AccountPage } from "./pages/AccountPage";
import { AdminAnnouncementEditPage } from "./pages/admin/AdminAnnouncementEditPage";
import { AdminBannerPage } from "./pages/admin/AdminBannerPage";
import { AdminHubPage } from "./pages/admin/AdminHubPage";
import { AdminUserBlockPage } from "./pages/admin/AdminUserBlockPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { CourseDetailPage } from "./pages/CourseDetailPage";
import { CoursesPage } from "./pages/CoursesPage";
import { LatestPage } from "./pages/LatestPage";
import { LoginPage } from "./pages/LoginPage";
import { LogoutPage } from "./pages/LogoutPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { NoticesPage } from "./pages/NoticesPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SubmitPage } from "./pages/SubmitPage";
import { TeacherDetailPage } from "./pages/TeacherDetailPage";
import { TeachersPage } from "./pages/TeachersPage";

const THEME_STORAGE_KEY = "jufexk-theme";

/** Dev-only: lazy so production builds do not ship Gallery / switcher / token CSS. */
const PrototypeGalleryPage = import.meta.env.DEV
  ? lazy(() =>
      import("./prototype/PrototypeGalleryPage").then((m) => ({
        default: m.PrototypeGalleryPage,
      })),
    )
  : null;

function DevPrototypeMount() {
  const [chrome, setChrome] = useState<ReactNode>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let cancelled = false;
    import("./prototype/DevPrototypeChrome").then((m) => {
      if (!cancelled) setChrome(<m.DevPrototypeChrome />);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{chrome}</>;
}

/**
 * Routes React Aria link navigations (e.g. Table.Row href) through React
 * Router instead of full-page reloads, so in-page state such as the course
 * review cache and scroll position survives row toggles (Issue #202).
 */
function RacClientNavigation({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <RouterProvider navigate={navigate} useHref={useHref}>
      {children}
    </RouterProvider>
  );
}

function applyColorScheme(mode: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode !== "dark");
  root.dataset.theme = mode;
}

export function App() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [banner, setBanner] = useState<SiteBanner | null>(null);

  useEffect(() => {
    api<SiteConfig>("/api/config")
      .then((c) => {
        setConfig(c);
        if (c.siteName) document.title = c.siteName;
      })
      .catch(() => {
        setConfig({
          siteName: "非官方课评@JUFE",
          universityName: "江西财经大学",
        });
      });
  }, []);

  useEffect(() => {
    api<SiteBanner>("/api/site/banner").then(setBanner).catch(() => setBanner(null));
  }, []);

  // Initial visit follows system; manual choice is remembered (foundations).
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);

    const resolve = (): "light" | "dark" => {
      if (stored === "light" || stored === "dark") return stored;
      return media.matches ? "dark" : "light";
    };

    applyColorScheme(resolve());

    const onMedia = () => {
      const current = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (current === "light" || current === "dark") return;
      applyColorScheme(media.matches ? "dark" : "light");
    };

    media.addEventListener("change", onMedia);

    (
      window as unknown as {
        __jufexkSetTheme?: (m: "light" | "dark" | "system") => void;
      }
    ).__jufexkSetTheme = (mode) => {
      if (mode === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
        applyColorScheme(media.matches ? "dark" : "light");
        return;
      }
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
      applyColorScheme(mode);
    };

    return () => {
      media.removeEventListener("change", onMedia);
      delete (
        window as unknown as {
          __jufexkSetTheme?: unknown;
        }
      ).__jufexkSetTheme;
    };
  }, []);

  return (
    <BrowserRouter>
      <RacClientNavigation>
        <ViewerProvider>
          <AdminSessionProvider>
            <AppShell banner={banner} config={config}>
              <Routes>
              <Route path="/" element={<Navigate to="/courses" replace />} />
              <Route path="/courses" element={<CoursesPage />} />
              <Route path="/courses/:id" element={<CourseDetailPage />} />
              <Route path="/latest" element={<LatestPage />} />
              <Route path="/teachers" element={<TeachersPage />} />
              <Route path="/teachers/:id" element={<TeacherDetailPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/logout" element={<LogoutPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/notices" element={<NoticesPage />} />
              <Route path="/submit" element={<SubmitPage config={config} />} />
              <Route path="/announcements" element={<AnnouncementsPage />} />
              <Route path="/admin" element={<AdminHubPage />} />
              <Route path="/admin/banner" element={<AdminBannerPage />} />
              <Route
                path="/admin/announcements/:id"
                element={<AdminAnnouncementEditPage />}
              />
              <Route path="/admin/users/:id" element={<AdminUserBlockPage />} />
              {PrototypeGalleryPage ? (
                <Route
                  path="/prototype"
                  element={
                    <Suspense fallback={<p className="text-sm text-muted">加载 Prototype…</p>}>
                      <PrototypeGalleryPage />
                    </Suspense>
                  }
                />
              ) : null}
              <Route path="*" element={<NotFoundPage />} />
              </Routes>
              {import.meta.env.DEV ? <DevPrototypeMount /> : null}
            </AppShell>
          </AdminSessionProvider>
        </ViewerProvider>
      </RacClientNavigation>
    </BrowserRouter>
  );
}
