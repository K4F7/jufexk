import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import readme from "../README.md?raw";

describe("site and repository icon", () => {
  it("declares favicon, apple-touch, and production og:image", () => {
    expect(indexHtml).toContain('rel="icon" href="/favicon.ico"');
    expect(indexHtml).toContain('href="/favicon.svg"');
    expect(indexHtml).toContain('href="/favicon-32.png"');
    expect(indexHtml).toContain('href="/favicon-16.png"');
    expect(indexHtml).toContain('rel="apple-touch-icon"');
    expect(indexHtml).toContain('href="/apple-touch-icon.png"');
    expect(indexHtml).toContain(
      'property="og:image" content="https://courses.sein.moe/icon-512.png"',
    );
    expect(indexHtml).toContain(
      'property="og:url" content="https://courses.sein.moe/"',
    );
    expect(indexHtml).not.toContain("xk.sein.moe");
  });

  it("shows the public site name on the document and README icon", () => {
    expect(indexHtml).toContain('property="og:title" content="非官方课评@JUFE"');
    expect(indexHtml).toContain("<title>非官方课评@JUFE</title>");
    expect(readme).toContain('src="public/icon-512.png"');
    expect(readme).toContain('alt="非官方课评@JUFE"');
  });
});
