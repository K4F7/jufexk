/** Split Set-Cookie safely when an upstream runtime folds several values. */
export function responseSetCookieLines(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?(): string[] };
  const values = [...(headers.getSetCookie?.() || [])];
  if (values.length === 0) {
    const single = response.headers.get("set-cookie");
    if (single) values.push(single);
  }
  return values.flatMap((value) =>
    value
      .split(/(?:,(?=\s*[A-Za-z0-9_.-]+=)|\r?\n(?=\s*[A-Za-z0-9_.-]+=))/g)
      .map((part) => part.trim()),
  );
}
