"use client";

import { useState, useTransition } from "react";
import { cancelScheduled } from "@/app/review/actions";

/** Cancels one scheduled post in OpusClip after a confirm. */
export function CancelPostButton({ postId, title }: { postId: string; title: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel() {
    if (!window.confirm(`Cancel "${title}"? It's removed from the OpusClip schedule and goes back into this week's picks.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelScheduled(postId);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={cancel}
        disabled={pending}
        className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-muted"
      >
        {pending ? "Canceling" : "Cancel"}
      </button>
      {error && <span className="max-w-xs text-right text-xs text-red-600">{error}</span>}
    </span>
  );
}
