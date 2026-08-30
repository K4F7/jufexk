import { Alert, Button, Card, Spinner } from "@heroui/react";
import { Navigate, Link as RouterLink, useSearchParams } from "react-router-dom";
import { useViewer } from "../hooks/useViewer";
import { readDevPreview } from "../lib/dev-preview";

const ACCOUNT_SECTION_CLASS =
  "mx-auto w-full min-w-0 max-w-xl overflow-x-clip py-4 sm:py-8 max-sm:max-w-none";

/**
 * Ordinary-user account page (issue #139). Logged-in visitors go to the
 * personal homepage; guests only see the login guide. The session payload
 * carries no email, sub or users.id, so no identifiers are ever rendered.
 */
export function AccountPage() {
  const { viewer, ready } = useViewer();
  const [searchParams] = useSearchParams();
  const preview = readDevPreview(searchParams);
  const forceGuest = preview === "guest";

  if (!ready && !forceGuest) {
    return (
      <section aria-labelledby="account-heading" className={ACCOUNT_SECTION_CLASS}>
        <p className="m-0 flex items-center gap-2 text-sm text-muted">
          <Spinner color="current" size="sm" />
          正在读取登录状态…
        </p>
      </section>
    );
  }

  if (viewer.authenticated && !forceGuest) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <section aria-labelledby="account-heading" className={ACCOUNT_SECTION_CLASS}>
      <Card className="min-w-0" role="article" aria-labelledby="account-heading">
        <Card.Header>
          <Card.Title
            className="max-sm:text-lg max-sm:font-semibold max-sm:leading-tight"
            id="account-heading"
          >
            账号管理
          </Card.Title>
          <Card.Description className="max-sm:hidden">你还没有登录</Card.Description>
        </Card.Header>
        <Card.Content>
          <Alert status="accent">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>当前未登录</Alert.Title>
            </Alert.Content>
          </Alert>
        </Card.Content>
        <Card.Footer className="flex-col items-stretch sm:flex-row">
          <Button
            className="w-full sm:w-auto"
            render={(domProps) => (
              <RouterLink
                {...(domProps as object)}
                className={
                  typeof domProps.className === "string"
                    ? domProps.className
                    : undefined
                }
                to={`/login?from=${encodeURIComponent("/account")}`}
              />
            )}
          >
            前往登录
          </Button>
        </Card.Footer>
      </Card>
    </section>
  );
}
