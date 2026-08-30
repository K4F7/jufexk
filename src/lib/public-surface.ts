/** Runtime public surface for nav. The SPA only reads `showScheduleNav` from /api/config. */
export function shouldShowScheduleNav(input: {
  publicSurface?: string | null;
  loopback: boolean;
}): boolean {
  if (input.loopback) return true;
  return input.publicSurface === "preview";
}
