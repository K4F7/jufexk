export function SectionHead({
  title,
  meta,
}: {
  title: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-2 mt-3 flex items-baseline justify-between gap-3">
      <h2 className="m-0 text-[17px] font-bold leading-snug">{title}</h2>
      {meta ? <span className="text-[13px] text-muted">{meta}</span> : null}
    </div>
  );
}
