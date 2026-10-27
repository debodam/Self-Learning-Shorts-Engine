import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { integrations, integrationStatus } from "@/lib/integrations/config";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Integrations are configured with environment variables in .env.local. Anything not connected uses mock data."
      />
      <Suspense fallback={<IntegrationsSkeleton />}>
        <IntegrationsList />
      </Suspense>
    </>
  );
}

async function IntegrationsList() {
  // Read env vars per request, not at build time.
  await connection();

  const rows = integrations.map((integration) => ({
    integration,
    ...integrationStatus(integration),
  }));
  const connectedCount = rows.filter((r) => r.connected).length;

  return (
    <IntegrationsCard summary={`${connectedCount} of ${rows.length} connected`}>
      {rows.map(({ integration, connected, missing, forcedMock }) => (
        <li
          key={integration.id}
          className="flex flex-col gap-3 border-b border-line px-6 py-5 last:border-0 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-medium text-heading">{integration.name}</p>
            <p className="mt-0.5 text-sm text-muted">{integration.description}</p>
            {forcedMock && (
              <p className="mt-2 text-xs text-muted">
                <code className="rounded bg-page px-1 py-0.5 font-mono text-body">OPUSCLIP_MOCK=true</code>: using mock
                responses, so no credits are spent.
              </p>
            )}
            {!connected && !forcedMock && (
              <p className="mt-2 text-xs text-muted">
                Missing{" "}
                {missing.map((name, i) => (
                  <span key={name}>
                    {i > 0 && ", "}
                    <code className="rounded bg-page px-1 py-0.5 font-mono text-body">{name}</code>
                  </span>
                ))}
              </p>
            )}
          </div>
          <StatusBadge connected={connected} label={forcedMock ? "Mock mode" : undefined} />
        </li>
      ))}
    </IntegrationsCard>
  );
}

function IntegrationsCard({ summary, children }: { summary?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface">
      <div className="flex items-baseline justify-between border-b border-line px-6 py-4">
        <h2 className="font-semibold text-heading">Integrations</h2>
        {summary && <span className="text-sm text-muted">{summary}</span>}
      </div>
      <ul>{children}</ul>
    </section>
  );
}

function IntegrationsSkeleton() {
  return (
    <IntegrationsCard>
      {integrations.map((integration) => (
        <li
          key={integration.id}
          className="flex items-start justify-between border-b border-line px-6 py-5 last:border-0"
        >
          <div>
            <p className="font-medium text-heading">{integration.name}</p>
            <p className="mt-0.5 text-sm text-muted">{integration.description}</p>
          </div>
          <span className="h-6 w-24 animate-pulse rounded-full bg-page" />
        </li>
      ))}
    </IntegrationsCard>
  );
}

function StatusBadge({ connected, label }: { connected: boolean; label?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-xs font-medium ${
        connected ? "bg-emerald-50 text-emerald-700" : "bg-page text-muted"
      }`}
    >
      <span className={`size-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted/50"}`} />
      {label ?? (connected ? "Connected" : "Not connected")}
    </span>
  );
}
