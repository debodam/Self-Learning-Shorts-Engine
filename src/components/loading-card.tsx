export function LoadingCard({ className = "h-64" }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-pulse rounded-card border border-line bg-surface ${className}`}
    />
  );
}
