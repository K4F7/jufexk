import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hmacHex } from "../src/ordinary-user-session";
import {
  defaultAvatarKey,
  formatPublicCode,
  formatPublicHandle,
} from "../src/public-handle";
import {
  ORDINARY_TEST_AUTH_SECRET,
  WRITE_ORIGIN,
  ordinaryWriteHeaders,
  ordinaryWriteSession,
} from "./ordinary-write-session";

async function stableUserId(userId: string) {
  return hmacHex(`ordinary-test-user:${userId}`, ORDINARY_TEST_AUTH_SECRET);
}

async function publicCodeFor(userId: string) {
  const id = await stableUserId(userId);
  const row = await env.DB.prepare(
    "SELECT public_code FROM users WHERE id=?",
  )
    .bind(id)
    .first<{ public_code: number }>();
  return { id, public_code: Number(row?.public_code) };
}

describe("public user profile and follow", () => {
  it("exposes reserved #000000 for unattributed reviews and rejects follow", async () => {
    await env.DB.prepare(
      `INSERT INTO reviews(
         course_id,teacher_id,category,overall,comment,status,submitter_hash
       ) VALUES(1,1,'general',4,'来自以前的学长学姐的评价正文','approved','anon-hash')`,
    ).run();
    const response = await SELF.fetch(`${WRITE_ORIGIN}/api/u/000000`);
    expect(response.status).toBe(200);
    const body = await response.json<{
      public_code: number;
      handle: string;
      reserved: boolean;
      followable: boolean;
      note: string;
      reviews: Array<{
        author_public_code: number;
        author_avatar_key: number;
        comment: string;
      }>;
    }>();
    expect(body).toMatchObject({
      public_code: 0,
      handle: "匿名用户#000000",
      reserved: true,
      followable: false,
      note: "来自以前的学长学姐的评价",
    });
    expect(
      body.reviews.some((review) => review.comment.includes("学长学姐")),
    ).toBe(true);
    expect(
      body.reviews.every((review) => review.author_public_code === 0),
    ).toBe(true);
    expect(
      body.reviews.every((review) => review.author_avatar_key === 0),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/"id":"[0-9a-f]{32}"/);

    const session = await ordinaryWriteSession("follow-reserved");
    const follow = await SELF.fetch(`${WRITE_ORIGIN}/api/u/000000/follow`, {
      method: "PUT",
      headers: ordinaryWriteHeaders(session),
    });
    expect(follow.status).toBe(400);
  });

  it("shows authored reviews under a real handle and allows follow", async () => {
    const author = await ordinaryWriteSession("public-author");
    const follower = await ordinaryWriteSession("public-follower");
    const { id: authorId, public_code } = await publicCodeFor(author.userId);
    const followerId = await stableUserId(follower.userId);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO reviews(
           course_id,teacher_id,category,overall,comment,headline,status,
           submitter_hash,author_user_id
         ) VALUES(1,1,'general',5,'作者公开点评','公开总结','approved','hash-a',?)`,
      ).bind(authorId),
      env.DB.prepare(
        `INSERT INTO reviews(
           course_id,teacher_id,category,overall,comment,status,
           submitter_hash,author_user_id
         ) VALUES(1,1,'general',3,'作者待审点评','pending','hash-p',?)`,
      ).bind(authorId),
    ]);

    const guest = await SELF.fetch(
      `${WRITE_ORIGIN}/api/u/${formatPublicCode(public_code)}`,
    );
    expect(guest.status).toBe(200);
    const guestBody = await guest.json<{
      handle: string;
      followable: boolean;
      reviews: Array<{ headline?: string; status?: string }>;
    }>();
    expect(guestBody.handle).toBe(formatPublicHandle(public_code));
    expect(guestBody.followable).toBe(false);
    expect(guestBody.reviews).toEqual([
      expect.objectContaining({ headline: "公开总结" }),
    ]);
    expect(JSON.stringify(guestBody)).not.toContain(authorId);
    expect(JSON.stringify(guestBody)).not.toContain("待审");

    const self = await SELF.fetch(
      `${WRITE_ORIGIN}/api/u/${formatPublicCode(public_code)}`,
      { headers: author.auth },
    );
    expect((await self.json<{ viewer_is_self: boolean }>()).viewer_is_self).toBe(
      true,
    );
    const selfFollow = await SELF.fetch(
      `${WRITE_ORIGIN}/api/u/${formatPublicCode(public_code)}/follow`,
      { method: "PUT", headers: ordinaryWriteHeaders(author) },
    );
    expect(selfFollow.status).toBe(400);

    const followed = await SELF.fetch(
      `${WRITE_ORIGIN}/api/u/${formatPublicCode(public_code)}/follow`,
      { method: "PUT", headers: ordinaryWriteHeaders(follower) },
    );
    expect(followed.status).toBe(200);
    expect(await followed.json()).toMatchObject({ viewer_followed: true });
    const viewing = await SELF.fetch(
      `${WRITE_ORIGIN}/api/u/${formatPublicCode(public_code)}`,
      { headers: follower.auth },
    );
    const viewingBody = await viewing.json();
    expect(viewingBody).toMatchObject({ viewer_followed: true });
    expect(JSON.stringify(viewingBody)).not.toContain(followerId);

    await env.DB.prepare(
      `INSERT INTO reviews(
         course_id,teacher_id,category,overall,comment,status,
         submitter_hash,author_user_id
       ) VALUES(1,1,'general',4,'关注后新点评','approved','hash-n',?)`,
    )
      .bind(authorId)
      .run();
    const inbox = await SELF.fetch(`${WRITE_ORIGIN}/api/user/notifications`, {
      headers: follower.auth,
    });
    const inboxBody = await inbox.json<{
      items: Array<{ type: string; message: string }>;
    }>();
    expect(inboxBody.items.some((item) => item.type === "followed_user_review")).toBe(
      true,
    );
    expect(
      inboxBody.items.some((item) =>
        item.message.includes(formatPublicHandle(public_code)),
      ),
    ).toBe(true);

    const unfollowed = await SELF.fetch(
      `${WRITE_ORIGIN}/api/u/${formatPublicCode(public_code)}/follow`,
      { method: "DELETE", headers: ordinaryWriteHeaders(follower) },
    );
    expect(await unfollowed.json()).toMatchObject({ viewer_followed: false });
  });

  it("projects reserved handle on public review lists", async () => {
    await env.DB.prepare(
      `INSERT INTO reviews(
         course_id,teacher_id,category,overall,comment,status,submitter_hash
       ) VALUES(1,1,'general',4,'公开流匿名点评','approved','list-anon')`,
    ).run();
    const latest = await SELF.fetch(`${WRITE_ORIGIN}/api/reviews/latest`);
    const latestBody = await latest.json<{
      items: Array<{ comment: string; author_public_code: number }>;
    }>();
    const anon = latestBody.items.find((item) => item.comment === "公开流匿名点评");
    expect(anon?.author_public_code).toBe(0);

    const author = await ordinaryWriteSession("list-author");
    const { id, public_code } = await publicCodeFor(author.userId);
    await env.DB.prepare(
      `INSERT INTO reviews(
         course_id,teacher_id,category,overall,comment,status,
         submitter_hash,author_user_id
       ) VALUES(1,1,'general',5,'公开流作者点评','approved','list-author',?)`,
    )
      .bind(id)
      .run();
    const again = await SELF.fetch(`${WRITE_ORIGIN}/api/reviews/latest`);
    const authored = (
      await again.json<{
        items: Array<{ comment: string; author_public_code: number }>;
      }>()
    ).items.find((item) => item.comment === "公开流作者点评");
    expect(authored?.author_public_code).toBe(public_code);
  });

  it("uses the stored avatar_key on numbered profile reviews", async () => {
    const author = await ordinaryWriteSession("stored-avatar-author");
    const { id, public_code } = await publicCodeFor(author.userId);
    const storedKey = (defaultAvatarKey(public_code) + 1) % 5;
    const patched = await SELF.fetch(`${WRITE_ORIGIN}/api/user/profile/avatar`, {
      method: "PATCH",
      headers: ordinaryWriteHeaders(author),
      body: JSON.stringify({ avatar_key: storedKey }),
    });
    expect(patched.status).toBe(200);
    await env.DB.prepare(
      `INSERT INTO reviews(
         course_id,teacher_id,category,overall,comment,status,
         submitter_hash,author_user_id
       ) VALUES(1,1,'general',5,'头像随存储值','approved','avatar-stored',?)`,
    )
      .bind(id)
      .run();

    const response = await SELF.fetch(
      `${WRITE_ORIGIN}/api/u/${formatPublicCode(public_code)}`,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      avatar_key: number;
      reviews: Array<{ comment: string; author_avatar_key: number }>;
    }>();
    expect(body.avatar_key).toBe(storedKey);
    expect(body.avatar_key).not.toBe(defaultAvatarKey(public_code));
    const authored = body.reviews.find(
      (review) => review.comment === "头像随存储值",
    );
    expect(authored?.author_avatar_key).toBe(storedKey);
  });
});
