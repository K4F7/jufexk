import { describe, expect, it } from "vitest";
import { injectLatestShell, renderLatestShell } from "../src/latest-ssr";
import type { LatestReview, PublicReviewPage } from "../src/lib/types";

const review = (overrides: Partial<LatestReview> = {}): LatestReview => ({
  id: "review:1",
  course_id: 1,
  teacher_id: 2,
  comment: "内容 <script>alert(1)</script>",
  comment_format: null,
  headline: null,
  grade: "2025",
  course_name: "课程 & 名称",
  course_code: "A-1",
  teacher_name: "教师",
  category: "通识",
  created_at: "2026-08-31T00:00:00.000Z",
  author_public_code: 123,
  author_avatar_key: null,
  ...overrides,
});

const page = (items: LatestReview[]): PublicReviewPage<LatestReview> => ({
  items,
  nextCursor: null,
});

describe("latest SSR shell", () => {
  it("renders escaped first reviews and safe JSON data", () => {
    const result = renderLatestShell(page([review()]));
    expect(result.html).toContain("最新课评");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("课程 &amp; 名称");
    expect(result.data).toContain('id="jufexk-latest-data"');
    expect(result.data).not.toContain("<script>alert");
  });

  it("falls back to an empty state and injects into the app root", () => {
    const result = injectLatestShell('<div id="app"></div>', page([]));
    expect(result).toContain("暂时还没有公开课评");
    expect(result).toContain('id="jufexk-latest-data"');
  });
});
