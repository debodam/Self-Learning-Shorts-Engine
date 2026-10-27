import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-line bg-surface px-6 py-14 text-center">
      <span className="mb-4 flex size-11 items-center justify-center rounded-full bg-primary-tint text-primary">
        <Icon className="size-5" />
      </span>
      <h2 className="font-semibold text-heading">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted">{children}</p>
    </div>
  );
}
