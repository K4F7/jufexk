import { Button, Typography, buttonVariants } from "@heroui/react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { DetailLoadingStatus } from "../../components/DetailFeedback";
import { RouterAriaLink } from "../../components/RouterAriaLink";
import { useAdminSession } from "../../hooks/useAdminSession";
import { useViewer } from "../../hooks/useViewer";

/**
 * 管理员分区门禁：已绑定学号的校园登录会在探测 /api/admin/session 时
 * 自动提升为管理员会话。不再接受 Cloudflare 共享口令。
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const { authed, ready } = useAdminSession();
  const { viewer, ready: viewerReady } = useViewer();

  if (!ready || !viewerReady) {
    return (
      <section className="mx-auto max-w-[480px]">
        <DetailLoadingStatus label="检查管理员会话…" />
      </section>
    );
  }

  if (!authed) {
    return (
      <section className="mx-auto max-w-[480px]">
        <Typography className="m-0 text-[22px] font-bold" type="h1">
          管理后台
        </Typography>
        <p className="mb-4 mt-2 text-[13px] text-muted">
          {viewer.authenticated
            ? "当前校园登录未绑定为管理员。请让已有管理员在「管理员学号」中加入你的学号，然后刷新本页。"
            : "管理分区只接受已绑定的校园统一身份学号。请先用该学号登录，再打开本页。"}
        </p>
        {viewer.authenticated ? null : (
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

  return <>{children}</>;
}

/** 管理分区统一页头：标题 + 说明 + 回管理首页 / 退出。 */
export function AdminPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const { logout } = useAdminSession();
  const navigate = useNavigate();
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Typography className="m-0 text-[22px] font-bold" type="h1">
          {title}
        </Typography>
        {description ? (
          <p className="mb-0 mt-1 text-[13px] text-muted">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" onPress={() => navigate("/admin")}>
          管理首页
        </Button>
        <Button size="sm" variant="outline" onPress={() => void logout()}>
          退出
        </Button>
      </div>
    </div>
  );
}
