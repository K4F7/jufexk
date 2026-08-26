export type BrowserCookie = { name: string; value: string };

const COOKIE_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

export function buildEhallCookieHeader(ehallCookies: BrowserCookie[], casCookies: BrowserCookie[]) {
  const selected = new Map<string, string>();
  for (const cookie of ehallCookies) selected.set(cookie.name, cookie.value);
  for (const cookie of casCookies) {
    if (["TGC", "SESSION", "CASTGC", "CASSTOC"].includes(cookie.name)) selected.set(cookie.name, cookie.value);
  }
  if (!selected.has("JSESSIONID")) return null;
  if (!["asessionid", "CASTGC", "MOD_AMP_AUTH"].some((name) => selected.has(name))) return null;
  for (const [name, value] of selected) {
    if (!COOKIE_NAME.test(name) || !value || /[\r\n;]/.test(value)) throw new Error("Browser returned an invalid cookie");
  }
  return [...selected].map(([name, value]) => `${name}=${value}`).join("; ");
}

function dotenvLiteral(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function updateEhallCookieEnv(existing: string, cookieHeader: string) {
  if (/\r|\n/.test(cookieHeader)) throw new Error("Cookie header must be one line");
  const replacement = `EHALL_COOKIE=${dotenvLiteral(cookieHeader)}`;
  const output: string[] = [];
  let replaced = false;
  for (const line of existing.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*EHALL_COOKIE\s*=/.test(line)) {
      if (!replaced) output.push(replacement);
      replaced = true;
    } else {
      output.push(line);
    }
  }
  if (!replaced) output.push(replacement);
  while (output.at(-1) === "") output.pop();
  return `${output.join("\n")}\n`;
}
