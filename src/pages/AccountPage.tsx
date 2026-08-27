import { Alert, Card, Spinner } from "@heroui/react";
import { Navigate, useSearchParams } from "react-router-dom";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useViewer } from "../hooks/useViewer";
import { readDevPreview } from "../lib/dev-preview";

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
      <section aria-labelledby="account-heading" className="mx-auto w-full max-w-xl py-8">
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
    <section aria-labelledby="account-heading" className="mx-auto w-full max-w-xl py-8">
      <Card role="article" aria-labelledby="account-heading">
        <Card.Header>
          <Card.Title id="account-heading">账号管理</Card.Title>
          <Card.Description>你还没有登录</Card.Description>
        </Card.Header>
        <Card.Content>
          <Alert status="accent">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>当前未登录</Alert.Title>
            </Alert.Content>
          </Alert>
        </Card.Content>
        <Card.Footer>
          <RouterAriaLink to={`/login?from=${encodeURIComponent("/account")}`}>
            前往登录
          </RouterAriaLink>
        </Card.Footer>
      </Card>
    </section>
  );
}
