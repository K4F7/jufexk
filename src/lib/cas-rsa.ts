import { constants, publicEncrypt } from "node:crypto";

export function encryptCasPassword(password: string, pem: string): string {
  const key = pem.trim();
  if (!key.includes("BEGIN") || !key.includes("PUBLIC KEY")) {
    throw new Error("invalid_cas_public_key");
  }
  const encrypted = publicEncrypt(
    { key, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(password, "utf8"),
  );
  return `__RSA__${encrypted.toString("base64")}`;
}
