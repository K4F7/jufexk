type RuntimeSecret = string | { get(): Promise<string> };
type TestableSecretBinding =
  | "ADMIN_PASSWORD"
  | "IP_HASH_SECRET"
  | "TURNSTILE_SECRET"
  | "CAMPUS_JWT_SECRET"
  | "CAMPUS_JWT_AES_KEY"
  | "CAMPUS_IDENTITY_SECRET"
  | "MAIL_DELIVERY_TOKEN"
  | "CAS_CHALLENGE_SECRET";

// Production bindings come from `wrangler types`; the overrides allow Miniflare
// tests to inject plain strings in place of Secrets Store bindings.
export type Bindings = Omit<Cloudflare.Env, TestableSecretBinding> & {
  ADMIN_PASSWORD?: string | { get(): Promise<string> };
  IP_HASH_SECRET: RuntimeSecret;
  TURNSTILE_SECRET?: RuntimeSecret;
  ORDINARY_USER_TEST_AUTH_SECRET?: string;
  CAMPUS_JWT_SECRET?: RuntimeSecret;
  CAMPUS_JWT_AES_KEY?: RuntimeSecret;
  CAMPUS_IDENTITY_SECRET?: RuntimeSecret;
  CAMPUS_JWT_ENABLED?: string;
  MAIL_DELIVERY_TOKEN?: RuntimeSecret;
  CAS_CHALLENGE_SECRET?: RuntimeSecret;
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: RuntimeSecret;
  OPENAI_MODEL?: string;
};
export type Vars = {
  adminSession?: string;
  adminSessionId?: string;
  adminCsrf?: string;
  publicCatalogCacheChanged?: boolean;
};

export type AppEnv = { Bindings: Bindings; Variables: Vars };
