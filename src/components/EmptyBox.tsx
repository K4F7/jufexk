export function EmptyBox({
  children,
  role = "status",
}: {
  children: React.ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div
      aria-live={role === "alert" ? "assertive" : "polite"}
      className="rounded border border-dashed border-border px-4 py-6 text-center text-muted sm:px-7 sm:py-7"
      role={role}
    >
      {children}
    </div>
  );
}
