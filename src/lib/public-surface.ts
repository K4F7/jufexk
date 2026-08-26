/** Runtime public surface for nav and docs. Vite DEV is a separate compile-time gate. */
export type PublicSurface = "production" | "preview";

export function shouldShowScheduleNav(input: {
  publicSurface?: string | null;
  loopback: boolean;
}): boolean {
  if (input.loopback) return true;
  return input.publicSurface === "preview";
}
