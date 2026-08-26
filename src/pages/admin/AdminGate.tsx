import { Tabs, Typography, buttonVariants } from "@heroui/react";
import type { ReactNode } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import { DetailLoadingStatus } from "../../components/DetailFeedback";
import { RouterAriaLink } from "../../components/RouterAriaLink";
import { useAdminSession } from "../../hooks/useAdminSession";
import { useViewer } from "../../hooks/useViewer";
import { isDevAtlasSession, readDevPreview } from "../../lib/dev-preview";

const ADMIN_TABS = [
  { id: "hub", href: "/admin", label: "概览" },
  { id: "banner", href: "/admin/banner", label: "Banner" },
  { id: "announcements", href: "/announcements", label: "公告" },
  { id: "admins", href: "/admin/admins", label: "学号" },
] as const;

/**
 * 管理员分区门禁：已绑定学号的校园登录会在探测 /api/admin/session 时
 * 自动提升为管理员会话。不再接受 Cloudflare 共享口令。
 */
function AdminForbidden({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mx-auto max-w-[480px]">
      <Typography className="m-0 text-[22px] font-bold" type="h1">
        管理后台
      </Typography>
      <p className="mb-4 mt-2 text-[13px] text-muted">
        当前身份不是管理员。
      </p>
      {authenticated ? null : (
        <RouterAriaLink
          className={`${buttonVariants({ variant: "primary" })} no-underline`}
          to="/login?from=/admin"
        >
          去登录
        </RouterAriaLink>
      )}
    </section>
  );
}

export function AdminGate({ children }: { children: ReactNode }) {
  const { authed, ready } = useAdminSession();
  const { viewer, ready: viewerReady } = useViewer();
  const [searchParams] = useSearchParams();
  const preview = readDevPreview(searchParams);
  const skipGate = isDevAtlasSession(searchParams) && preview !== "forbidden";

  if (preview === "forbidden") {
    return <AdminForbidden authenticated={viewer.authenticated} />;
  }

  if (skipGate) {
    return <>{children}</>;
  }

  if (!ready || !viewerReady) {
    return (
      <section className="mx-auto max-w-[480px]">
        <DetailLoadingStatus label="检查管理员会话…" />
      </section>
    );
  }

  if (!authed) {
    return <AdminForbidden authenticated={viewer.authenticated} />;
  }

  return <>{children}</>;
}

function adminTabKey(pathname: string): string {
  if (pathname === "/admin/banner") return "banner";
  if (pathname === "/admin/admins") return "admins";
  if (
    pathname === "/announcements" ||
    pathname.startsWith("/admin/announcements/")
  ) {
    return "announcements";
  }
  return "hub";
}

/** 管理分区内的官方 Tabs 导航，href 接到 React Router，可新标签打开。 */
export function AdminSectionNav() {
  const { pathname } = useLocation();
  return (
    <Tabs className="mb-6 w-full" selectedKey={adminTabKey(pathname)}>
      <Tabs.ListContainer>
        <Tabs.List aria-label="管理分区">
          {ADMIN_TABS.map((tab, index) => (
            <Tabs.Tab
              key={tab.id}
              href={tab.href}
              id={tab.id}
              render={(domProps) => (
                <NavLink
                  {...(domProps as object)}
                  className={
                    typeof domProps.className === "string"
                      ? domProps.className
                      : undefined
                  }
                  to={tab.href}
                />
              )}
            >
              {index > 0 ? <Tabs.Separator /> : null}
              {tab.label}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}

/** 管理分区统一页头：标题 + 说明。分区切换走 AdminSectionNav。 */
export function AdminPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <Typography className="m-0 text-[22px] font-bold" type="h1">
        {title}
      </Typography>
      {description ? (
        <p className="mb-0 mt-1 text-[13px] text-muted">{description}</p>
      ) : null}
    </div>
  );
}

/** 已登录管理员的分区骨架：页头 + Tabs + 内容。 */
export function AdminLayout({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <AdminGate>
      <section className="mx-auto max-w-[860px]">
        <AdminPageHeader description={description} title={title} />
        <AdminSectionNav />
        {children}
      </section>
    </AdminGate>
  );
}
