/**
 * DEV-only floating identity switcher. Replaces prototype theme-variant cycling.
 * Sets `?as=guest|user|admin` (and sessionStorage) so Viewer / admin gates
 * follow the mock role without a real CAS login.
 */
import { Button } from "@heroui/react";
import { useSearchParams } from "react-router-dom";
import { useAdminSession } from "../hooks/useAdminSession";
import { useViewer } from "../hooks/useViewer";
import {
  DEV_AS_PARAM,
  persistDevIdentity,
  previewNotificationInbox,
  previewUnreadNotificationCount,
  readDevIdentity,
  readDevPreview,
  type DevIdentity,
} from "../lib/dev-preview";

const ROLES: { id: DevIdentity; label: string }[] = [
  { id: "guest", label: "游客" },
  { id: "user", label: "用户" },
  { id: "admin", label: "管理员" },
];

export function DevIdentitySwitcher() {
  const [params, setParams] = useSearchParams();
  const { viewer } = useViewer();
  const { authed: adminAuthed } = useAdminSession();
  const identity = readDevIdentity(params);
  const preview = readDevPreview(params);
  const previewSignedIn =
    previewUnreadNotificationCount(preview) != null ||
    previewNotificationInbox(preview) != null;
  const selected: DevIdentity =
    identity ??
    (adminAuthed
      ? "admin"
      : viewer.authenticated || previewSignedIn
        ? "user"
        : "guest");

  function setIdentity(next: DevIdentity) {
    persistDevIdentity(import.meta.env.DEV, next);
    const nextParams = new URLSearchParams(params);
    nextParams.set(DEV_AS_PARAM, next);
    setParams(nextParams, { replace: true });
  }

  if (typeof navigator !== "undefined" && navigator.webdriver) return null;

  return (
    <div
      aria-label="身份切换"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex justify-center px-3"
    >
      <div className="pointer-events-auto flex max-w-[min(720px,100%)] flex-wrap items-center justify-center gap-1 rounded-full border border-border bg-overlay/95 px-2 py-1.5 text-overlay-foreground shadow-overlay backdrop-blur">
        {ROLES.map((role) => {
          const isSelected = selected === role.id;
          return (
            <Button
              key={role.id}
              aria-pressed={isSelected}
              size="sm"
              variant={isSelected ? "primary" : "secondary"}
              onPress={() => setIdentity(role.id)}
            >
              {role.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
