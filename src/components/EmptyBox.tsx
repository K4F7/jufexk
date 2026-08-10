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
      className="rounded border border-dashed border-border px-7 py-7 text-center text-muted"
      role={role}
    >
      {children}
    </div>
  );
}
