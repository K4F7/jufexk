import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { api } from "./lib/api";
import type { SiteConfig } from "./lib/types";
import { CourseDetailPage } from "./pages/CourseDetailPage";
import { CoursesPage } from "./pages/CoursesPage";
import { TeacherDetailPage } from "./pages/TeacherDetailPage";
import { TeachersPage } from "./pages/TeachersPage";

export function App() {
  const [config, setConfig] = useState<SiteConfig | null>(null);

  useEffect(() => {
    api<SiteConfig>("/api/config")
      .then((c) => {
        setConfig(c);
        if (c.siteName) document.title = c.siteName;
      })
      .catch(() => {
        setConfig({
          siteName: "江财选课参考",
          universityName: "江西财经大学",
        });
      });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = media.matches;
      root.classList.toggle("dark", dark);
      root.classList.toggle("light", !dark);
      root.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return (
    <BrowserRouter>
      <AppShell config={config}>
        <Routes>
          <Route path="/" element={<Navigate to="/courses" replace />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/courses/:id" element={<CourseDetailPage />} />
          <Route path="/teachers" element={<TeachersPage />} />
          <Route path="/teachers/:id" element={<TeacherDetailPage />} />
          <Route path="*" element={<Navigate to="/courses" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
