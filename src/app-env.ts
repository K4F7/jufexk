type RuntimeSecret = string | { get(): Promise<string> };
type TestableSecretBinding =
  | "IP_HASH_SECRET"
  | "TURNSTILE_SECRET"
  | "CAMPUS_IDENTITY_SECRET"
  | "CAS_CHALLENGE_SECRET";

// Production bindings come from `wrangler types`; the overrides allow Miniflare
// tests to inject plain strings in place of Secrets Store bindings.
export type Bindings = Omit<Cloudflare.Env, TestableSecretBinding> & {
  IP_HASH_SECRET: RuntimeSecret;
  TURNSTILE_SECRET?: RuntimeSecret;
  ORDINARY_USER_TEST_AUTH_SECRET?: string;
  CAMPUS_IDENTITY_SECRET?: RuntimeSecret;
  MAIL_DELIVERY_URL?: string;
  MAIL_FROM?: string;
  MAIL_DELIVERY_TOKEN?: RuntimeSecret;
  REVIEW_AUTHOR_LOOKUP_TO?: RuntimeSecret;
  CAS_CHALLENGE_SECRET?: RuntimeSecret;
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: RuntimeSecret;
  OPENAI_MODEL?: string;
};
export type Vars = {
  adminSession?: string;
  adminSessionId?: string;
  adminCsrf?: string;
  adminSource?: "student";
  publicCatalogCacheChanged?: boolean;
};

export type AppEnv = { Bindings: Bindings; Variables: Vars };
