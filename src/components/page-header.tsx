export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-8">
      <h1 className="text-3xl font-bold tracking-tight text-heading">{title}</h1>
      {description && <p className="mt-2 text-muted">{description}</p>}
    </header>
  );
}
