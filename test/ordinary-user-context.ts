import { env } from "cloudflare:test";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnv } from "../src/app-env";
import {
  ORDINARY_TEST_AUTH_SECRET,
  WRITE_ORIGIN,
} from "./ordinary-write-session";

export { ORDINARY_TEST_AUTH_SECRET };
export const ORDINARY_IDENTITY_SECRET = "test-campus-identity";
export const ORDINARY_TEST_ORIGIN = WRITE_ORIGIN;

export async function withOrdinaryUserContext<T>(
  request: Request,
  handle: (c: Context<AppEnv>) => Promise<T>,
  testEnv: typeof env = env,
): Promise<{ value: T; response: Response }> {
  let value!: T;
  const app = new Hono<AppEnv>();
  app.all("*", async (c) => {
    value = await handle(c);
    return c.body(null);
  });
  const response = await app.request(request, undefined, testEnv);
  return { value, response };
}

export function ordinaryUserRequest(
  path: string,
  headers: HeadersInit = {},
  urlOrigin = ORDINARY_TEST_ORIGIN,
) {
  return new Request(`${urlOrigin}${path}`, { headers });
}

export function withBinding<K extends string>(
  name: K,
  value: unknown,
  testEnv: typeof env = env,
): typeof env {
  return new Proxy(testEnv, {
    get(target, property, receiver) {
      if (property === name) return value;
      return Reflect.get(target, property, receiver);
    },
  });
}
