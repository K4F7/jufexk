import { SELF, env } from "cloudflare:test";
import {
  ORDINARY_USER_ID_HEADER,
  ORDINARY_USER_MAC_HEADER,
  hmacHex,
  ordinaryUserTestHeaders,
} from "../src/ordinary-user-authentication";
import { ORDINARY_USER_CSRF_COOKIE } from "../src/ordinary-user-write-authorization";

export const WRITE_ORIGIN = "https://example.com";
export const ORDINARY_TEST_AUTH_SECRET = "test-ordinary-user-auth";

export type OrdinaryWriteSession = {
  userId: string;
  auth: Record<string, string>;
  authenticated: boolean;
  csrf: string;
  cookie: string;
};

export async function ordinaryWriteSession(
  userId: string,
): Promise<OrdinaryWriteSession> {
  const auth = await ordinaryUserTestHeaders(userId, ORDINARY_TEST_AUTH_SECRET);
  const response = await SELF.fetch(`${WRITE_ORIGIN}/api/user/session`, {
    headers: auth,
  });
  const body = await response.json<{
    authenticated: boolean;
    csrfToken?: string;
  }>();
  return {
    userId,
    auth,
    authenticated: body.authenticated,
    csrf: body.csrfToken || "",
    cookie: `${ORDINARY_USER_CSRF_COOKIE}=${body.csrfToken}`,
  };
}

export function ordinaryWriteHeaders(
  session: OrdinaryWriteSession,
  extra: Record<string, string> = {},
) {
  return {
    "Content-Type": "application/json",
    [ORDINARY_USER_ID_HEADER]: session.auth[ORDINARY_USER_ID_HEADER],
    [ORDINARY_USER_MAC_HEADER]: session.auth[ORDINARY_USER_MAC_HEADER],
    Cookie: extra.Cookie ?? session.cookie,
    Origin: extra.Origin ?? WRITE_ORIGIN,
    "X-CSRF-Token": extra["X-CSRF-Token"] ?? session.csrf,
    ...extra,
  };
}

export async function setOrdinaryUserStatus(userId: string, status: string) {
  const stableUserId = await hmacHex(
    `ordinary-test-user:${userId}`,
    ORDINARY_TEST_AUTH_SECRET,
  );
  await env.DB.prepare("UPDATE users SET status=? WHERE id=?").bind(
    status,
    stableUserId,
  ).run();
  return stableUserId;
}
