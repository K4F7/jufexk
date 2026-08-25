import { describe, expect, it, vi } from "vitest";
import iconv from "iconv-lite";
import { JwxtAuthAdapter } from "../scripts/jwxt-collector/auth-adapter";
import { collectJwxt, type AuthAdapter } from "../scripts/jwxt-collector/collector";

function gbk(html: string, status = 200) {
  return new Response(iconv.encode(html, "gbk"), { status });
}

const discoveryHtml = `<!doctype html><html><body>
<select name="xnxq"><option value="2025,1">旧学期</option><option selected value="2026,0">当前学期</option></select>
<select name="sel_pycc"><option selected value="05">本科</option></select>
<select name="sel_nj"><option selected value="2025">2025</option></select>
<table><tr><th>课程</th><th>任课教师</th><th>上课班号</th><th>容量</th><th>已选人数</th><th>余量</th></tr>
<tr><td>[000001]测试课程</td><td>张老师</td><td>A01</td><td>50</td><td>10</td><td>40</td></tr></table>
</body></html>`;

function pageHtml(current: number, pages: number) {
  return `<!doctype html><html><body><table id="keywords"><tbody>
<tr><th>课程</th><th>任课教师</th><th>上课班号</th><th>开课校区</th><th>周次</th><th>上课时间</th><th>上课地点</th><th>容量</th><th>已选人数</th><th>余量</th></tr>
<tr><td>[000001]测试课程</td><td>张老师</td><td>A0${current}</td><td>蛟桥园</td><td>1-16周</td><td>周一第1-2节</td><td>一教101</td><td>50</td><td>10</td><td>40</td></tr>
</tbody></table><script>parent.showTotalRecord('5327042','${pages}');reloadPage('/taglib/DataTable.jsp',${current},${pages});</script></body></html>`;
}

describe("JWXT GHA collector", () => {
  it("follows the service-ticket callback and keeps JSESSIONID only in memory", async () => {
    const calls: Array<{ url: string; cookie: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, cookie: new Headers(init?.headers).get("cookie") || "" });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            location: "/student/index.jsp",
            "set-cookie": "JSESSIONID=jwxt-secret; Path=/; HttpOnly",
          },
        });
      }
      return new Response("ok");
    });
    const adapter = new JwxtAuthAdapter("20250001", "secret", fetchImpl as typeof fetch);
    await (adapter as unknown as { followTicket(location: string): Promise<void> }).followTicket(
      "https://jwxt.jxufe.edu.cn/jxcjcaslogin?ticket=ST-fixture",
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].cookie).toBe("JSESSIONID=jwxt-secret");
  });

  it("relogs once when a JWXT request redirects back to CAS", async () => {
    let requests = 0;
    const adapter = new JwxtAuthAdapter("20250001", "secret", vi.fn(async () => {
      requests += 1;
      return requests === 1
        ? new Response(null, { status: 302, headers: { location: "https://ssl.jxufe.edu.cn/cas/login" } })
        : new Response("ok");
    }) as typeof fetch);
    (adapter as any).cookies.set("JSESSIONID", "expired");
    let relogins = 0;
    (adapter as any).login = async () => {
      relogins += 1;
      (adapter as any).cookies.set("JSESSIONID", "renewed");
    };
    const response = await adapter.request("/taglib/DataTable.jsp");
    expect(response.status).toBe(200);
    expect(relogins).toBe(1);
    expect(requests).toBe(2);
  });

  it("discovers the selected default term, decodes GBK and strips capacity fields", async () => {
    const requests: Array<{ path: string; body: string }> = [];
    const responses = [gbk(discoveryHtml), gbk(pageHtml(1, 2)), gbk(pageHtml(2, 2))];
    const adapter: AuthAdapter = {
      request: async (path, init) => {
        requests.push({ path, body: String(init?.body || "") });
        return responses.shift()!;
      },
    };
    const capture = await collectJwxt(adapter, "pilot", async () => {});
    expect(capture.complete).toBe(false);
    expect(capture.offerings).toHaveLength(2);
    expect(capture.offerings[0]).toMatchObject({ termId: "2026,0", courseCode: "000001" });
    expect(JSON.stringify(capture)).not.toMatch(/capacity|selected|available/i);
    expect(requests[1].body).toContain("xnxq=2026%2C0");
    expect(requests[2].path).toContain("currPageCount=2");
  });

  it("marks full captures complete only after traversing every discovered term", async () => {
    const bodies: string[] = [];
    const responses = [gbk(discoveryHtml), gbk(pageHtml(1, 1)), gbk(pageHtml(1, 1))];
    const capture = await collectJwxt(
      { request: async (_path, init) => {
        bodies.push(String(init?.body || ""));
        return responses.shift()!;
      } },
      "full",
      async () => {},
    );
    expect(capture.complete).toBe(true);
    expect(bodies.some((body) => body.includes("xnxq=2025%2C1"))).toBe(true);
    expect(bodies.some((body) => body.includes("xnxq=2026%2C0"))).toBe(true);
  });

  it("resumes a full audit from the saved page checkpoint", async () => {
    let checkpoint: any;
    const firstResponses = [gbk(discoveryHtml), gbk(pageHtml(1, 2))];
    await expect(collectJwxt(
      { request: async () => firstResponses.shift() || Promise.reject(new Error("interrupted")) },
      "full",
      async () => {},
      { save: async (value) => { checkpoint = structuredClone(value); } },
    )).rejects.toThrow("interrupted");
    expect(checkpoint).toMatchObject({ dimensionIndex: 0, nextPage: 2, pageCount: 2 });
    const requested: string[] = [];
    const resumedResponses = [
      gbk(discoveryHtml),
      gbk(pageHtml(2, 2)),
      gbk(pageHtml(1, 1)),
    ];
    const capture = await collectJwxt(
      { request: async (path) => {
        requested.push(path);
        return resumedResponses.shift()!;
      } },
      "resume",
      async () => {},
      { resume: checkpoint, save: async () => {} },
    );
    expect(requested[1]).toContain("currPageCount=2");
    expect(capture.complete).toBe(true);
    expect(capture.offerings).toHaveLength(3);
  });

  it("retries transient server errors without publishing an empty capture", async () => {
    const responses = [gbk(discoveryHtml), gbk("busy", 500), gbk(pageHtml(1, 1))];
    const sleeps: number[] = [];
    const capture = await collectJwxt(
      { request: async () => responses.shift()! },
      "pilot",
      async (milliseconds) => { sleeps.push(milliseconds); },
    );
    expect(capture.offerings).toHaveLength(1);
    expect(sleeps).toContain(2_000);
  });
});
