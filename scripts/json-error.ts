export function jsonErrorMessage(body: unknown, status: number): string {
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string" &&
    body.error
  ) {
    return body.error;
  }
  return String(status);
}
