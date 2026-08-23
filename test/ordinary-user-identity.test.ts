import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  AUTH_PROVIDER_CAS,
  CAS_IDENTITY_ISSUER,
  resolveOrCreateIdentityUser,
} from "../src/ordinary-user-identity";

function countD1RoundTrips(database: D1Database) {
  let roundTrips = 0;
  const nativeStatements = new WeakMap<object, D1PreparedStatement>();

  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values));
        }
        if (property === "first") {
          return (columnName?: string) => {
            roundTrips += 1;
            return columnName === undefined ? target.first() : target.first(columnName);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    nativeStatements.set(wrapped, statement);
    return wrapped;
  };

  const db = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrapStatement(target.prepare(query));
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          roundTrips += 1;
          return target.batch(
            statements.map((statement) => nativeStatements.get(statement) || statement),
          );
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { db, roundTrips: () => roundTrips };
}

describe("ordinary-user identity lookup latency", () => {
  it("creates a CAS identity in two D1 round trips and reuses it in one", async () => {
    const subject = `cas-perf-${crypto.randomUUID()}`;
    const first = countD1RoundTrips(env.DB);
    const created = await resolveOrCreateIdentityUser(first.db, {
      provider: AUTH_PROVIDER_CAS,
      issuer: CAS_IDENTITY_ISSUER,
      subject,
    });

    expect(created).toMatchObject({ status: "active" });
    expect(first.roundTrips()).toBe(2);

    const repeat = countD1RoundTrips(env.DB);
    const reused = await resolveOrCreateIdentityUser(repeat.db, {
      provider: AUTH_PROVIDER_CAS,
      issuer: CAS_IDENTITY_ISSUER,
      subject,
    });

    expect(reused?.id).toBe(created?.id);
    expect(repeat.roundTrips()).toBe(1);
  });

  it("keeps concurrent creation on one CAS user without orphan rows", async () => {
    const subject = `cas-race-${crypto.randomUUID()}`;
    const users = await Promise.all(
      Array.from({ length: 8 }, () =>
        resolveOrCreateIdentityUser(env.DB, {
          provider: AUTH_PROVIDER_CAS,
          issuer: CAS_IDENTITY_ISSUER,
          subject,
        }),
      ),
    );

    expect(new Set(users.map((user) => user?.id)).size).toBe(1);
    const identity = await env.DB.prepare(
      "SELECT user_id FROM auth_identities WHERE provider=? AND issuer=? AND subject=?",
    )
      .bind(AUTH_PROVIDER_CAS, CAS_IDENTITY_ISSUER, subject)
      .first<{ user_id: string }>();
    const rows = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE id=?")
      .bind(identity?.user_id)
      .first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });
});
