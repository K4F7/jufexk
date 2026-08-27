import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  CTA_DEFAULT_AVATAR_SHA256,
  CTA_FID,
  ctaHomepageUrl,
  sha256Hex,
} from "../src/cta-teacher-homepage";
import {
  createHttpCtaClient,
  syncTeacherCtaHomepage,
  type CtaPhotoResponse,
  type CtaTeacherClient,
} from "../src/cta-teacher-sync";
import { adminHeaders, adminLogin } from "./admin-session";

const origin = "https://example.com";

const REAL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

async function insertTeacher(name: string, department = "测试学院") {
  const result = await env.DB.prepare(
    "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
  )
    .bind(name, name, department)
    .run();
  return Number(result.meta.last_row_id);
}

function fakeClient(options: {
  candidates?: Array<{
    uid: number;
    realname: string;
    photo: string | null;
    deptName: string | null;
  }>;
  photo?: CtaPhotoResponse | null;
  detailPhoto?: string | null;
}): CtaTeacherClient {
  return {
    async searchTeachers() {
      const candidates = options.candidates ?? [];
      return {
        candidates,
        total: candidates.length,
        truncated: false,
      };
    },
    async fetchTeacherPhotoId() {
      if (options.detailPhoto !== undefined) return options.detailPhoto;
      return options.candidates?.[0]?.photo ?? null;
    },
    async fetchPhoto(url) {
      if (options.photo === undefined) {
        return { bytes: REAL_PNG, contentType: "image/png", url };
      }
      return options.photo;
    },
  };
}

describe("CTA teacher homepage sync", () => {
  it("does not fetch or store the CTA default silhouette", async () => {
    const teacherId = await insertTeacher("默认头像教师");
    const client = createHttpCtaClient(async () => {
      throw new Error("should not fetch default icon");
    });
    await expect(
      client.fetchPhoto("http://cta.jxufe.edu.cn/_jxcj/images/defaulticon.png"),
    ).resolves.toBeNull();

    const urlDefaultId = await insertTeacher("链接默认头像教师");
    const result = await syncTeacherCtaHomepage(
      env.DB,
      teacherId,
      fakeClient({
        candidates: [
          {
            uid: 136660080,
            realname: "默认头像教师",
            photo: "defaulticon",
            deptName: "测试学院",
          },
        ],
      }),
    );
    const urlDefault = await syncTeacherCtaHomepage(
      env.DB,
      urlDefaultId,
      fakeClient({
        candidates: [
          {
            uid: 136660081,
            realname: "链接默认头像教师",
            photo: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            deptName: "测试学院",
          },
        ],
        photo: {
          bytes: REAL_PNG,
          contentType: "image/png",
          url: "http://cta.jxufe.edu.cn/_jxcj/images/defaulticon.png",
        },
      }),
    );
    expect(urlDefault.avatarStored).toBe(false);
    expect(urlDefault.skippedDefaultAvatar).toBe(true);
    expect(result).toMatchObject({
      teacherId,
      match: "unique",
      homepageUrl: ctaHomepageUrl(136660080),
      avatarStored: false,
      skippedDefaultAvatar: true,
    });
    expect(
      await env.DB.prepare(
        "SELECT avatar_sha256,homepage_url FROM teachers WHERE id=?",
      )
        .bind(teacherId)
        .first(),
    ).toEqual({
      avatar_sha256: null,
      homepage_url: ctaHomepageUrl(136660080),
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM teacher_avatars WHERE teacher_id=?",
      )
        .bind(teacherId)
        .first(),
    ).toEqual({ n: 0 });
  });

  it("stores a real CTA photo and serves it from our origin", async () => {
    const teacherId = await insertTeacher("真人头像教师");
    const sha = await sha256Hex(REAL_PNG);
    expect(sha).not.toBe(CTA_DEFAULT_AVATAR_SHA256);
    const result = await syncTeacherCtaHomepage(
      env.DB,
      teacherId,
      fakeClient({
        candidates: [
          {
            uid: 19699165,
            realname: "真人头像教师",
            photo: "fc558c61ffb76f65b78e8f142265bf83",
            deptName: "测试学院",
          },
        ],
      }),
    );
    expect(result.avatarStored).toBe(true);
    const body = await SELF.fetch(`${origin}/api/teachers/${teacherId}`).then(
      (response) =>
        response.json<{
          teacher: {
            official_homepage_url: string | null;
            avatar_url: string | null;
            cta_uid?: number;
          };
        }>(),
    );
    expect(body.teacher.official_homepage_url).toBe(ctaHomepageUrl(19699165));
    expect(body.teacher.avatar_url).toBe(`/api/teachers/${teacherId}/avatar`);
    expect(body.teacher).not.toHaveProperty("cta_uid");

    const avatar = await SELF.fetch(
      `${origin}/api/teachers/${teacherId}/avatar`,
    );
    expect(avatar.status).toBe(200);
    expect(avatar.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await avatar.arrayBuffer())).toEqual(REAL_PNG);
  });

  it("does not bind when the same name is ambiguous without a department match", async () => {
    const teacherId = await insertTeacher("张强", "");
    const result = await syncTeacherCtaHomepage(
      env.DB,
      teacherId,
      fakeClient({
        candidates: [
          {
            uid: 1,
            realname: "张强",
            photo: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            deptName: "计算机与人工智能学院",
          },
          {
            uid: 2,
            realname: "张强",
            photo: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            deptName: "金融学院",
          },
        ],
      }),
    );
    expect(result.match).toBe("ambiguous");
    expect(result.homepageUrl).toBeNull();
    expect(result.avatarStored).toBe(false);
  });

  it("hides locked or default-hash avatars from the public API", async () => {
    const teacherId = await insertTeacher("锁图教师");
    await env.DB.prepare(
      `UPDATE teachers
          SET homepage_url=?,cta_fid=?,cta_uid=?,homepage_match='unique',
              image_locked=1,avatar_sha256=?
        WHERE id=?`,
    )
      .bind(
        ctaHomepageUrl(42),
        CTA_FID,
        42,
        CTA_DEFAULT_AVATAR_SHA256,
        teacherId,
      )
      .run();
    const body = await SELF.fetch(`${origin}/api/teachers/${teacherId}`).then(
      (response) =>
        response.json<{
          teacher: {
            official_homepage_url: string | null;
            avatar_url: string | null;
          };
        }>(),
    );
    expect(body.teacher.official_homepage_url).toBe(ctaHomepageUrl(42));
    expect(body.teacher.avatar_url).toBeNull();
    expect(
      (await SELF.fetch(`${origin}/api/teachers/${teacherId}/avatar`)).status,
    ).toBe(404);
  });
});

describe("admin CTA homepage controls", () => {
  it("lets maintainers lock a photo and set a CTA homepage without changing user avatars", async () => {
    const teacherId = await insertTeacher("人工绑定教师");
    await env.DB.prepare(
      `INSERT INTO teacher_avatars(teacher_id,content_type,sha256,bytes,source_url)
       VALUES(?,?,?,?,?)`,
    )
      .bind(
        teacherId,
        "image/png",
        await sha256Hex(REAL_PNG),
        REAL_PNG,
        "https://p.ananas.chaoxing.com/star3/origin/real.png",
      )
      .run();
    await env.DB.prepare("UPDATE teachers SET avatar_sha256=? WHERE id=?")
      .bind(await sha256Hex(REAL_PNG), teacherId)
      .run();
    const auth = await adminLogin();
    const patched = await SELF.fetch(`${origin}/api/admin/teachers`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        id: teacherId,
        sourceTeacherLabel: "人工绑定教师",
        name: "人工绑定教师",
        homepageUrl: ctaHomepageUrl(99),
        homepageLocked: 1,
        imageLocked: 1,
      }),
    });
    expect(patched.status).toBe(200);
    const stored = await env.DB.prepare(
      `SELECT homepage_url,homepage_locked,homepage_match,image_locked,avatar_sha256
         FROM teachers WHERE id=?`,
    )
      .bind(teacherId)
      .first();
    expect(stored).toMatchObject({
      homepage_url: ctaHomepageUrl(99),
      homepage_locked: 1,
      homepage_match: "manual",
      image_locked: 1,
      avatar_sha256: null,
    });
    const publicBody = await SELF.fetch(
      `${origin}/api/teachers/${teacherId}`,
    ).then(
      (response) =>
        response.json<{
          teacher: {
            official_homepage_url: string | null;
            avatar_url: string | null;
          };
        }>(),
    );
    expect(publicBody.teacher.official_homepage_url).toBe(ctaHomepageUrl(99));
    expect(publicBody.teacher.avatar_url).toBeNull();
  });
});
