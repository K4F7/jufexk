export type SecretBinding = string | { get(): Promise<string> } | undefined | null;

export async function readSecret(value: SecretBinding): Promise<string> {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return (await value.get()) ?? "";
}

export function turnstileMode(
  siteKey: string | undefined,
  secret: string,
): "enabled" | "disabled" | "site-only" | "secret-only" {
  const hasSiteKey = Boolean(siteKey);
  const hasSecret = Boolean(secret);
  if (hasSiteKey && hasSecret) return "enabled";
  if (hasSiteKey) return "site-only";
  if (hasSecret) return "secret-only";
  return "disabled";
}
