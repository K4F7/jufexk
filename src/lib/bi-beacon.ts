type BiBeaconPayload = {
  type: "review_view" | "review_dwell" | "login_view";
  courseId?: number;
  teacherId?: number;
  ms?: number;
};

export function sendBiBeacon(payload: BiBeaconPayload) {
  try {
    void fetch("/api/bi/beacon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "same-origin",
    });
  } catch {
    /* Beacon is best-effort and must never surface to the page. */
  }
}
