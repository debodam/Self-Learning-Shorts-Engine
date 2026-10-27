export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted">{label}</span>
      <div role="group" aria-label={label} className="flex rounded-lg border border-line bg-surface p-0.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                active ? "bg-primary-tint font-medium text-primary" : "text-body hover:bg-page"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
