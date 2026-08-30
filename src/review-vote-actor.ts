import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  hmacHex,
  resolveOrdinaryUser,
} from "./ordinary-user-authentication";
import {
  canOrdinaryUserWrite,
  isOrdinaryUserAuthenticated,
  ordinaryUserMutationSecurityOk,
} from "./ordinary-user-write-authorization";
import { readSecret } from "./secrets";

export const VOTER_COOKIE = "jufexk_voter";
export const VOTER_TTL_SECONDS = 400 * 24 * 60 * 60;
const LOCAL_VOTER_SECRET_FALLBACK = "jufexk-local-dev-identity";

const fail = (c: Context, error: string, status: 403) =>
  c.json({ error }, status);

const randomId = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

async function voterSecret(c: Context) {
  const secret = await readSecret(c.env.CAMPUS_IDENTITY_SECRET);
  return secret || LOCAL_VOTER_SECRET_FALLBACK;
}

export function guestVoterKey(id: string) {
  return `guest:${id}`;
}

function parseVoterPair(raw: string | undefined) {
  const value = (raw || "").trim();
  const match = /^([0-9a-f]{32})\.([0-9a-f]{64})$/i.exec(value);
  if (!match) return null;
  return { id: match[1].toLowerCase(), mac: match[2].toLowerCase() };
}

async function verifyVoterCookie(raw: string | undefined, secret: string) {
  const pair = parseVoterPair(raw);
  if (!pair) return null;
  const expected = await hmacHex(pair.id, secret);
  if (expected !== pair.mac) return null;
  return pair.id;
}

export async function issueGuestVoterCookie(c: Context, id = randomId()) {
  const secret = await voterSecret(c);
  const token = `${id}.${await hmacHex(id, secret)}`;
  setCookie(c, VOTER_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: VOTER_TTL_SECONDS,
  });
  return guestVoterKey(id);
}

export async function readVoteActorId(c: Context): Promise<string | null> {
  const user = await resolveOrdinaryUser(c);
  if (user && isOrdinaryUserAuthenticated(user)) return user.id;
  const id = await verifyVoterCookie(
    getCookie(c, VOTER_COOKIE),
    await voterSecret(c),
  );
  return id ? guestVoterKey(id) : null;
}

export async function requireVoteActor(
  c: Context,
  forbiddenError: string,
): Promise<{ id: string } | { error: Response }> {
  if (!ordinaryUserMutationSecurityOk(c)) {
    return { error: fail(c, "安全校验失败，请刷新后重试", 403) };
  }
  const user = await resolveOrdinaryUser(c);
  if (user) {
    if (!canOrdinaryUserWrite(user)) {
      return { error: fail(c, forbiddenError, 403) };
    }
    return { id: user.id };
  }
  const existing = await verifyVoterCookie(
    getCookie(c, VOTER_COOKIE),
    await voterSecret(c),
  );
  return { id: existing ? guestVoterKey(existing) : await issueGuestVoterCookie(c) };
}
