/** Runtime public surface for nav. Vite DEV is a separate compile-time gate. */
export function shouldShowScheduleNav(input: {
  publicSurface?: string | null;
  loopback: boolean;
}): boolean {
  if (input.loopback) return true;
  return input.publicSurface === "preview";
}
