export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-heading">{title}</h1>
        {description && <p className="mt-2 text-muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
