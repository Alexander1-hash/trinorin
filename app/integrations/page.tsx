"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Database,
  KeyRound,
  Link2,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

type Integration = {
  id: string;
  provider: string;
  integration_type: string;
  display_name: string;
  status: string;
  scopes: string[];
  last_sync_at: string | null;
  created_at: string;
  connection_state: string;
  authorization_state?: {
    asset_selection?: {
      business_id: string | null;
      waba_id: string | null;
      phone_number_id: string | null;
      verified: boolean;
    };
    webhook_subscription?: {
      waba_id: string | null;
      subscribed: boolean;
      subscribed_at: string | null;
    };
  };
};

type IntegrationHealth = {
  integrationId: string;
  displayName: string;
  provider: string;
  status: string;
  stage: "registered" | "authorized" | "asset_verified" | "webhook_subscribed" | "ingestion_active";
  checks: {
    registered: boolean;
    authorized: boolean;
    credentialExpired: boolean;
    assetVerified: boolean;
    webhookSubscribed: boolean;
    firstEventReceived: boolean;
    analysisReady: boolean;
  };
  lastTelemetryAt: string | null;
  nextAction: string;
};

type TokenNotice = {
  integrationId: string;
  integrationName: string;
  token: string;
};

type MetaBusiness = {
  id: string;
  name: string | null;
};

type WhatsAppPhone = {
  id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  code_verification_status: string | null;
};

type WhatsAppBusinessAccount = {
  id: string;
  name: string | null;
  business_id: string | null;
  business_name: string | null;
  phoneNumbers: WhatsAppPhone[];
};

type DiscoveredAssets = {
  businesses: MetaBusiness[];
  whatsappBusinessAccounts: WhatsAppBusinessAccount[];
};

function syncAgeLabel(lastSyncAt: string | null) {
  if (!lastSyncAt) return "No telemetry received yet.";
  const ageMs = Math.max(0, Date.now() - new Date(lastSyncAt).getTime());
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes < 1) return "Telemetry received less than a minute ago.";
  if (ageMinutes < 60) return `Telemetry received ${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} ago.`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `Telemetry received ${ageHours} hour${ageHours === 1 ? "" : "s"} ago.`;
  const ageDays = Math.floor(ageHours / 24);
  return `Telemetry received ${ageDays} day${ageDays === 1 ? "" : "s"} ago.`;
}

const endpointCatalogItem = {
    provider: "Endpoint",
    type: "endpoint",
    title: "Endpoint security",
    description: "Authorized telemetry from company laptops, desktops and supported mobile devices.",
    icon: ShieldCheck,
    scopes: ["device_inventory", "security_events", "device_posture", "network_signals"],
  };

const catalog = [
  {
    provider: "WhatsApp Business",
    type: "whatsapp",
    title: "WhatsApp Business",
    description: "Authorized business messaging signals, conversations and security-relevant links where the permitted API access supports them.",
    icon: MessageCircle,
    scopes: ["messages", "webhooks", "business_metadata"],
  },
  {
    provider: "X",
    type: "x",
    title: "X",
    description: "Authorized account, post and supported interaction signals through the X developer platform.",
    icon: Send,
    scopes: ["account_metadata", "posts", "mentions"],
  },
  {
    provider: "Meta",
    type: "meta",
    title: "Instagram & Facebook",
    description: "Authorized business-account messaging and social activity signals through supported Meta APIs.",
    icon: MessageCircle,
    scopes: ["business_metadata", "messages", "webhooks"],
  },
  {
    provider: "Telegram",
    type: "telegram",
    title: "Telegram",
    description: "Authorized bot or business messaging events for security analysis and evidence ingestion.",
    icon: Send,
    scopes: ["messages", "webhooks", "bot_metadata"],
  },
  {
    provider: "Cloud",
    type: "cloud",
    title: "Cloud security",
    description: "Infrastructure inventory, audit activity and identity signals.",
    icon: Cloud,
    scopes: ["asset_inventory", "audit_logs", "identity_metadata"],
  },
  {
    provider: "Identity",
    type: "identity",
    title: "Identity provider",
    description: "Authentication, sessions, roles and access relationships.",
    icon: KeyRound,
    scopes: ["users", "roles", "authentication_events"],
  },
  {
    provider: "Application",
    type: "application",
    title: "Business application",
    description: "Authorized audit and activity signals from critical software.",
    icon: Link2,
    scopes: ["audit_logs", "activity_events"],
  },
  {
    provider: "Database",
    type: "database",
    title: "Database telemetry",
    description: "Read-only audit and access signals without collecting database passwords.",
    icon: Database,
    scopes: ["audit_logs", "access_events", "metadata"],
  },
];

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(catalog[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [tokenNotice, setTokenNotice] = useState<TokenNotice | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [executionUrl, setExecutionUrl] = useState("");
  const [configuringExecution, setConfiguringExecution] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [discoveredAssets, setDiscoveredAssets] = useState<Record<string, DiscoveredAssets>>({});
  const [selectingAsset, setSelectingAsset] = useState<string | null>(null);
  const [subscribingWebhook, setSubscribingWebhook] = useState<string | null>(null);
  const [selectedWabaIds, setSelectedWabaIds] = useState<Record<string, string>>({});
  const [integrationHealth, setIntegrationHealth] = useState<Record<string, IntegrationHealth>>({});
  const [healthCheckedAt, setHealthCheckedAt] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const catalogWithEndpoint = [...catalog, endpointCatalogItem];

  async function loadIntegrations(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoading(true);
    setHealthLoading(true);
    try {
      const [integrationResponse, healthResponse] = await Promise.all([
        fetch("/api/security/integrations", { cache: "no-store" }),
        fetch("/api/security/integrations/health", { cache: "no-store" }),
      ]);
      const [data, healthData] = await Promise.all([
        integrationResponse.json(),
        healthResponse.json(),
      ]);

      if (integrationResponse.ok) {
        setIntegrations(data.integrations ?? []);
      } else if (!options.silent) {
        setMessage(data.error ?? "Unable to load integrations.");
      }

      if (healthResponse.ok) {
        const nextHealth: Record<string, IntegrationHealth> = {};
        for (const item of Array.isArray(healthData.health) ? healthData.health : []) {
          if (item && typeof item.integrationId === "string") {
            nextHealth[item.integrationId] = item as IntegrationHealth;
          }
        }
        setIntegrationHealth(nextHealth);
        setHealthCheckedAt(typeof healthData.checkedAt === "string" ? healthData.checkedAt : null);
      } else if (!options.silent) {
        setMessage(healthData.error ?? "Unable to evaluate integration health.");
      }
    } catch {
      if (!options.silent) setMessage("Unable to load integration health.");
    } finally {
      setHealthLoading(false);
      if (!options.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadIntegrations();

    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const connectionError = params.get("connection_error");

    if (connected) setMessage(`${connected} authorization completed successfully.`);
    if (connectionError) setMessage(connectionError);

    if (connected || connectionError) {
      window.history.replaceState({}, "", "/integrations");
    }
  }, []);

  async function rotateToken(integration: Integration) {
    setRotatingId(integration.id);
    setMessage("");

    try {
      const response = await fetch("/api/security/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rotate_token", integrationId: integration.id }),
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "Unable to rotate the ingestion token.");
        return;
      }

      if (data.token) {
        setTokenNotice({ integrationId: integration.id, integrationName: integration.display_name, token: data.token });
        setMessage("The previous ingestion token is no longer valid.");
      }
      await loadIntegrations();
    } finally {
      setRotatingId(null);
    }
  }

  async function connectIntegration(integration: Integration) {
    const supported = new Set(["x", "meta", "whatsapp", "discord", "slack"]);
    if (!supported.has(integration.integration_type)) {
      setMessage(
        integration.integration_type === "telegram"
          ? "Telegram requires a bot/business credential setup rather than this OAuth connection flow."
          : "This integration requires provider-specific setup before Trinorin can authorize it.",
      );
      return;
    }

    setConnectingId(integration.id);
    setMessage("");

    try {
      const response = await fetch(
        `/api/security/integrations/connect?integrationId=${encodeURIComponent(integration.id)}&provider=${encodeURIComponent(integration.integration_type)}`,
        { cache: "no-store" },
      );
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "Unable to start provider authorization.");
        return;
      }

      if (typeof data.authorizationUrl !== "string") {
        setMessage("The provider authorization URL was not returned.");
        return;
      }

      window.location.assign(data.authorizationUrl);
    } catch {
      setMessage("Unable to start provider authorization.");
    } finally {
      setConnectingId(null);
    }
  }

  async function discoverMetaAssets(integration: Integration) {
    setDiscoveringId(integration.id);
    setMessage("");
    try {
      const response = await fetch(
        `/api/security/integrations/meta/assets?integrationId=${encodeURIComponent(integration.id)}&provider=${encodeURIComponent(integration.integration_type)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Unable to discover Meta assets.");
        return;
      }
      const businesses: MetaBusiness[] = Array.isArray(data.businesses)
        ? data.businesses.filter((item: unknown): item is MetaBusiness =>
            Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"),
          )
        : [];
      const whatsappBusinessAccounts: WhatsAppBusinessAccount[] = integration.integration_type === "whatsapp" && Array.isArray(data.whatsappBusinessAccounts)
        ? (data.whatsappBusinessAccounts as unknown[])
            .filter((item: unknown): item is WhatsAppBusinessAccount =>
              Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"),
            )
            .map((item: WhatsAppBusinessAccount) => ({
              ...item,
              phoneNumbers: Array.isArray(item.phoneNumbers)
                ? (item.phoneNumbers as unknown[]).filter((phone: unknown): phone is WhatsAppPhone =>
                    Boolean(phone && typeof phone === "object" && typeof (phone as { id?: unknown }).id === "string"),
                  )
                : [],
            }))
        : [];
      setDiscoveredAssets((current) => ({
        ...current,
        [integration.id]: { businesses, whatsappBusinessAccounts },
      }));
      if (integration.integration_type === "whatsapp") {
        const phones = whatsappBusinessAccounts.reduce((count, waba) => count + waba.phoneNumbers.length, 0);
        setMessage(
          `Meta discovery completed: ${businesses.length} business account(s), ${whatsappBusinessAccounts.length} WhatsApp Business Account(s), ${phones} phone number(s) found. Select a WABA and phone number to continue.`,
        );
      } else {
        setMessage(`Meta discovery completed: ${businesses.length} business account(s). Select the intended business asset to continue.`);
      }
    } catch {
      setMessage("Unable to discover Meta assets.");
    } finally {
      setDiscoveringId(null);
    }
  }

  async function selectMetaAsset(integration: Integration, selection: { businessId?: string; wabaId?: string; phoneNumberId?: string }) {
    setSelectingAsset(integration.id);
    setMessage("");
    try {
      const response = await fetch("/api/security/integrations/meta/assets/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrationId: integration.id,
          provider: integration.integration_type,
          ...selection,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Unable to validate the selected asset.");
        return;
      }
      if (integration.integration_type === "whatsapp" && selection.wabaId) {
        setSelectedWabaIds((current) => ({ ...current, [integration.id]: selection.wabaId as string }));
      }
      setMessage(
        integration.integration_type === "whatsapp"
          ? "WhatsApp WABA and phone number verified. The webhook can now be subscribed."
          : "Meta business asset verified. Trinorin can now use only the explicitly selected asset.",
      );
      await loadIntegrations();
    } catch {
      setMessage("Unable to validate the selected asset.");
    } finally {
      setSelectingAsset(null);
    }
  }

  async function subscribeWhatsAppWebhook(integration: Integration, wabaId: string) {
    setSubscribingWebhook(integration.id);
    setMessage("");
    try {
      const response = await fetch("/api/security/integrations/meta/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: integration.id, wabaId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Unable to subscribe the WhatsApp webhook.");
        return;
      }
      setMessage("Meta confirmed the WhatsApp Business Account webhook subscription. Trinorin will only mark live ingestion after a signed event is actually received.");
      await loadIntegrations();
    } catch {
      setMessage("Unable to subscribe the WhatsApp webhook.");
    } finally {
      setSubscribingWebhook(null);
    }
  }

  async function configureExecution(integrationId: string) {
    if (!executionUrl.trim()) {
      setMessage("Enter the HTTPS provider execution webhook URL first.");
      return;
    }

    setConfiguringExecution(true);
    setMessage("");

    try {
      const response = await fetch("/api/security/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "configure_execution",
          integrationId,
          executionWebhookUrl: executionUrl.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "Unable to configure provider execution.");
        return;
      }

      setMessage("Provider execution webhook configured. The deployment allowlist and executor secret are still required before execution can run.");
      setExecutionId(null);
      setExecutionUrl("");
      await loadIntegrations();
    } finally {
      setConfiguringExecution(false);
    }
  }

  async function registerIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/security/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selected.provider,
          integrationType: selected.type,
          displayName: selected.title,
          scopes: selected.scopes,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "Unable to register integration.");
        return;
      }

      setMessage("Integration registered. Trinorin is ready for an authorized connection.");
      setOpen(false);
      if (data.token && data.integration?.display_name) {
        setTokenNotice({ integrationId: data.integration.id, integrationName: data.integration.display_name, token: data.token });
      }
      await loadIntegrations();
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#071018] text-slate-100">
      <header className="border-b border-white/10 bg-[#071018]/95">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-white">Security Integrations</p>
              <p className="text-[11px] text-slate-500">Authorized telemetry sources</p>
            </div>
          </div>
          <Link href="/" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-400 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Command Center
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Evidence layer</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Connect real security signals</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Trinorin registers the integration first. Connection methods will use authorized OAuth, delegated access, or scoped API credentials rather than raw passwords.
            </p>
          </div>
          <button onClick={() => setOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950">
            <Plus className="h-4 w-4" /> Register integration
          </button>
        </div>

        {message && (
          <div className="mt-5 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4 text-sm text-cyan-200">
            {message}
          </div>
        )}

        <section className="mt-8">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-cyan-300" />
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Integration health</p>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {healthCheckedAt
                  ? "Checked " + new Date(healthCheckedAt).toLocaleString() + ". Health is evidence-based; authorization does not imply live telemetry."
                  : "Health checks verify the lifecycle state without exposing provider credentials."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadIntegrations({ silent: true })}
              disabled={healthLoading}
              className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-slate-300 hover:bg-white/[0.03] disabled:opacity-50"
            >
              <Loader2 className={"h-3.5 w-3.5 " + (healthLoading ? "animate-spin" : "")} />
              Refresh health
            </button>
          </div>

          {integrations.length ? (
            <div className="space-y-3">
              {integrations.map((integration) => {
                const health = integrationHealth[integration.id];
                const steps = [
                  ["Registered", health?.checks.registered === true],
                  ["Authorized", health?.checks.authorized === true && health?.checks.credentialExpired !== true],
                  ["Asset", health?.checks.assetVerified === true],
                  ["Webhook", health?.checks.webhookSubscribed === true],
                  ["Event", health?.checks.firstEventReceived === true],
                  ["Analysis eligible", health?.checks.analysisReady === true],
                ] as const;
                return (
                  <div key={integration.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-white">{integration.display_name}</p>
                          {health ? (
                            <span className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.04] px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-cyan-200">
                              {health.stage.replaceAll("_", " ")}
                            </span>
                          ) : (
                            <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] uppercase tracking-wider text-slate-600">Checking</span>
                          )}
                        </div>
                        <p className="mt-1 text-[10px] text-slate-600">{health?.nextAction ?? "Evaluating integration lifecycle."}</p>
                      </div>
                      <div className="text-[9px] text-slate-600">
                        {health?.lastTelemetryAt ? syncAgeLabel(health.lastTelemetryAt) : "No signed event received yet."}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                      {steps.map(([label, complete]) => (
                        <div key={label} className={"rounded-xl border p-2.5 " + (complete ? "border-emerald-400/15 bg-emerald-400/[0.04]" : "border-white/10 bg-black/10")}>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className={"h-3.5 w-3.5 " + (complete ? "text-emerald-300" : "text-slate-700")} />
                            <span className={"text-[9px] font-semibold " + (complete ? "text-emerald-200" : "text-slate-600")}>{label}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {health?.checks.credentialExpired ? (
                      <p className="mt-3 rounded-lg border border-amber-400/10 bg-amber-400/[0.03] px-3 py-2 text-[9px] text-amber-200">
                        The stored provider credential has expired. Reauthorization is required before new provider access can be trusted.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 p-5 text-xs text-slate-600">
              Register an integration to begin lifecycle health verification.
            </div>
          )}
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyan-300" />
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Integration catalog</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {catalogWithEndpoint.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.type}
                  onClick={() => { setSelected(item); setOpen(true); }}
                  className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-left transition hover:border-cyan-400/20 hover:bg-cyan-400/[0.03]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-cyan-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="rounded-full bg-white/5 px-2 py-1 text-[9px] uppercase tracking-wider text-slate-500">Connector definition</span>
                  </div>
                  <p className="mt-5 text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{item.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.scopes.map((scope) => (
                      <span key={scope} className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-slate-500">{scope.replaceAll("_", " ")}</span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-300" />
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Registered integrations</p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading integration state...</div>
          ) : integrations.length ? (
            <div className="space-y-3">
              {integrations.map((integration) => (
                <div key={integration.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-white">{integration.display_name}</p>
                      <p className="mt-1 text-xs text-slate-500">{integration.provider} · {integration.integration_type}</p>
                    </div>
                    <span
                      className={
                        integration.status === "connected"
                          ? "inline-flex w-fit items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-300"
                          : integration.status === "error"
                            ? "inline-flex w-fit items-center gap-1 rounded-full bg-rose-400/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-rose-300"
                            : "inline-flex w-fit items-center gap-1 rounded-full bg-amber-400/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
                      }
                    >
                      {integration.status === "connected" ? <CheckCircle2 className="h-3 w-3" /> : null}
                      {integration.status}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {integration.scopes.map((scope) => (
                      <span key={scope} className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-slate-500">{scope.replaceAll("_", " ")}</span>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <div className="space-y-1">
                        <p className="text-[10px] text-slate-500">
                          {integration.last_sync_at
                            ? `Last telemetry received: ${new Date(integration.last_sync_at).toLocaleString()}`
                            : integration.status === "connected"
                              ? "Telemetry channel active · provider authorization is not asserted."
                              : "Not connected · no telemetry is being claimed."}
                        </p>
                        {integration.last_sync_at ? (
                          <p className="text-[10px] text-slate-600">{syncAgeLabel(integration.last_sync_at)}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] uppercase tracking-wider text-slate-500">
                          {integration.connection_state.replaceAll("_", " ")}
                        </span>
                        {integration.status === "connected" ? (
                          <Link href="/" className="text-[10px] font-semibold text-cyan-300 hover:text-white">
                            Open Command Center →
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    {["x", "meta", "whatsapp", "discord", "slack"].includes(integration.integration_type) ? (
                      <button
                        type="button"
                        onClick={() => void connectIntegration(integration)}
                        disabled={connectingId === integration.id || integration.connection_state === "authorized"}
                        className="inline-flex w-fit items-center gap-2 rounded-lg border border-cyan-400/15 px-3 py-2 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-400/5 disabled:opacity-50"
                      >
                        {connectingId === integration.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                        {integration.connection_state === "authorized" ? "Provider authorized" : "Connect provider"}
                      </button>
                    ) : null}
                    {["meta", "whatsapp"].includes(integration.integration_type) && integration.connection_state !== "not_connected" ? (
                      <div className="w-full space-y-3 rounded-2xl border border-violet-400/10 bg-violet-400/[0.025] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void discoverMetaAssets(integration)}
                            disabled={discoveringId === integration.id}
                            className="inline-flex w-fit items-center gap-2 rounded-lg border border-violet-400/15 px-3 py-2 text-[10px] font-semibold text-violet-200 hover:bg-violet-400/5 disabled:opacity-50"
                          >
                            {discoveringId === integration.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                            {discoveredAssets[integration.id] ? "Refresh business assets" : "Discover business assets"}
                          </button>
                        </div>

                        {discoveredAssets[integration.id]?.businesses.length ? (
                          <div className="space-y-2">
                            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                              {integration.integration_type === "whatsapp" ? "Authorized businesses" : "Select Meta business"}
                            </p>
                            {discoveredAssets[integration.id].businesses.map((business) => (
                              <div key={business.id} className="rounded-xl border border-white/10 bg-black/10 p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <p className="text-[11px] font-semibold text-white">{business.name || "Unnamed business"}</p>
                                    <p className="text-[9px] text-slate-600">Business ID: {business.id}</p>
                                  </div>
                                  {integration.integration_type === "meta" ? (
                                    <button
                                      type="button"
                                      onClick={() => void selectMetaAsset(integration, { businessId: business.id })}
                                      disabled={selectingAsset === integration.id}
                                      className="rounded-lg bg-violet-300 px-3 py-2 text-[9px] font-semibold text-slate-950 disabled:opacity-50"
                                    >
                                      {selectingAsset === integration.id ? "Validating..." : "Select business"}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {integration.integration_type === "whatsapp" && discoveredAssets[integration.id]?.whatsappBusinessAccounts.length ? (
                          <div className="space-y-3">
                            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">WhatsApp Business Accounts</p>
                            {discoveredAssets[integration.id].whatsappBusinessAccounts.map((waba) => (
                              <div key={waba.id} className="rounded-xl border border-white/10 bg-black/10 p-3">
                                <div>
                                  <p className="text-[11px] font-semibold text-white">{waba.name || "WhatsApp Business Account"}</p>
                                  <p className="text-[9px] text-slate-600">{waba.business_name || "Business"} · WABA {waba.id}</p>
                                </div>
                                <div className="mt-3 space-y-2">
                                  {waba.phoneNumbers.length ? waba.phoneNumbers.map((phone) => (
                                    <div key={phone.id} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-[#071018] p-2.5 sm:flex-row sm:items-center sm:justify-between">
                                      <div>
                                        <p className="text-[10px] font-medium text-white">{phone.display_phone_number || phone.id}</p>
                                        <p className="text-[9px] text-slate-600">{phone.verified_name || "Verified name unavailable"} · {phone.quality_rating || "quality unknown"}</p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => void selectMetaAsset(integration, { wabaId: waba.id, phoneNumberId: phone.id })}
                                        disabled={selectingAsset === integration.id}
                                        className="rounded-lg bg-violet-300 px-3 py-2 text-[9px] font-semibold text-slate-950 disabled:opacity-50"
                                      >
                                        {selectingAsset === integration.id ? "Validating..." : "Select phone"}
                                      </button>
                                    </div>
                                  )) : (
                                    <p className="text-[9px] text-slate-600">No phone numbers were returned for this WABA.</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {integration.integration_type === "whatsapp" && ["asset_verified", "webhook_subscribed", "ingestion_active"].includes(integration.connection_state) ? (
                          <div className="rounded-xl border border-emerald-400/10 bg-emerald-400/[0.03] p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-[10px] font-semibold text-emerald-200">Asset verified</p>
                                <p className="mt-1 text-[9px] text-slate-600">
                                  {integration.authorization_state?.webhook_subscription?.subscribed
                                    ? "Meta has confirmed the WABA subscription. Live ingestion remains pending until a signed event is received."
                                    : "Subscribe the selected WABA to the webhook configured for Trinorin's Meta app."}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const wabaId =
                                    selectedWabaIds[integration.id] ??
                                    integration.authorization_state?.asset_selection?.waba_id ??
                                    "";
                                  if (wabaId) void subscribeWhatsAppWebhook(integration, wabaId);
                                  else setMessage("Select and validate a WhatsApp phone number before subscribing the webhook.");
                                }}
                                disabled={subscribingWebhook === integration.id || Boolean(integration.authorization_state?.webhook_subscription?.subscribed)}
                                className="rounded-lg bg-emerald-300 px-3 py-2 text-[9px] font-semibold text-slate-950 disabled:opacity-50"
                              >
                                {integration.authorization_state?.webhook_subscription?.subscribed
                                  ? "Webhook subscribed"
                                  : subscribingWebhook === integration.id
                                    ? "Subscribing..."
                                    : "Subscribe webhook"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {executionId === integration.id ? (
                      <div className="w-full rounded-xl border border-emerald-400/10 bg-emerald-400/[0.025] p-3 sm:w-auto sm:min-w-[340px]">
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-emerald-200">Provider execution</p>
                        <input
                          value={executionUrl}
                          onChange={(event) => setExecutionUrl(event.target.value)}
                          placeholder="https://provider.example/execute"
                          className="mt-2 w-full rounded-lg border border-white/10 bg-[#071018] px-3 py-2 text-[10px] text-white placeholder:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/20"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void configureExecution(integration.id)}
                            disabled={configuringExecution}
                            className="inline-flex items-center gap-2 rounded-lg bg-emerald-300 px-3 py-2 text-[10px] font-semibold text-slate-950 disabled:opacity-50"
                          >
                            {configuringExecution ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                            Save executor
                          </button>
                          <button
                            type="button"
                            onClick={() => { setExecutionId(null); setExecutionUrl(""); }}
                            className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-slate-400"
                          >
                            Cancel
                          </button>
                        </div>
                        <p className="mt-2 text-[8px] leading-4 text-slate-600">Use an HTTPS endpoint you control. The endpoint receives only after an operator-authorized action passes Trinorin target validation.</p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setExecutionId(integration.id); setExecutionUrl(""); }}
                        className="inline-flex w-fit items-center gap-2 rounded-lg border border-emerald-400/15 px-3 py-2 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-400/5"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Configure provider executor
                      </button>
                    )}
                    <button
                      onClick={() => void rotateToken(integration)}
                      disabled={rotatingId === integration.id}
                      className="inline-flex w-fit items-center gap-2 rounded-lg border border-cyan-400/15 px-3 py-2 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-400/5 disabled:opacity-50"
                    >
                      {rotatingId === integration.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                      Rotate ingestion token
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 px-6 py-14 text-center">
              <Link2 className="mx-auto h-8 w-8 text-slate-700" />
              <p className="mt-4 text-sm font-semibold text-slate-300">No telemetry integrations registered</p>
              <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-600">
                Register an integration to define the evidence Trinorin is authorized to receive.
              </p>
            </div>
          )}
        </section>
      </div>


      {tokenNotice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-cyan-400/20 bg-[#0b151f] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">One-time credential</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Ingestion token created</h2>
              </div>
              <button onClick={() => setTokenNotice(null)} className="rounded-lg p-2 text-slate-500 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              Use this token only from an authorized telemetry source for <strong className="text-white">{tokenNotice.integrationName}</strong>. Trinorin stores only a hash and will not show this token again.
            </p>
            <div className="mt-5 break-all rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-xs text-cyan-200">
              {tokenNotice.token}
            </div>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(tokenNotice.token);
                setMessage("Ingestion token copied. Store it securely.");
              }}
              className="mt-4 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950"
            >
              Copy token
            </button>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-semibold text-white">Send your first telemetry event</p>
              <p className="mt-1 text-[10px] leading-5 text-slate-500">
                Use the token from your authorized server, collector, or automation. The example below is a safe connectivity check and does not claim that a real security incident occurred.
              </p>
              <pre className="mt-3 max-h-44 overflow-auto rounded-xl border border-white/10 bg-[#050b10] p-3 text-[9px] leading-4 text-cyan-100"><code>{`curl -X POST ${typeof window !== "undefined" ? window.location.origin : ""}/api/security/ingest \\\
  -H "Authorization: Bearer ${tokenNotice.token}" \\\
  -H "Content-Type: application/json" \\\
  -d '{"evidenceType":"telemetry","source":"authorized_test","title":"Trinorin ingestion connectivity test","summary":"Authorized test event received from a configured telemetry source.","securityState":"healthy","eventType":"integration_test","severity":"info"}'`}</code></pre>
              <button
                onClick={() => {
                  const command = `curl -X POST ${window.location.origin}/api/security/ingest -H "Authorization: Bearer ${tokenNotice.token}" -H "Content-Type: application/json" -d '{"evidenceType":"telemetry","source":"authorized_test","title":"Trinorin ingestion connectivity test","summary":"Authorized test event received from a configured telemetry source.","securityState":"healthy","eventType":"integration_test","severity":"info"}'`;
                  void navigator.clipboard?.writeText(command);
                  setMessage("Connectivity-test command copied. Run it only from an authorized telemetry environment.");
                }}
                className="mt-3 w-full rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-xs font-semibold text-cyan-200"
              >
                Copy connectivity test command
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-amber-400/10 bg-amber-400/[0.04] p-3">
              <p className="text-[10px] font-semibold text-amber-200">Credential safety</p>
              <p className="mt-1 text-[10px] leading-5 text-slate-500">
                Rotating the token immediately invalidates the previous token. Never place it in client-side code, public repositories, or chat.
              </p>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-lg max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-3xl border border-white/10 bg-[#0b151f] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Register integration</h2>
                <p className="mt-1 text-xs text-slate-500">No credentials are requested at this stage.</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={registerIntegration} className="mt-6 space-y-4">
              <select
                value={selected.type}
                onChange={(event) => {
                  const next = catalogWithEndpoint.find((item) => item.type === event.target.value);
                  if (next) setSelected(next);
                }}
                className="w-full rounded-xl border border-white/10 bg-[#071018] px-4 py-3 text-sm text-white"
              >
                {catalogWithEndpoint.map((item) => <option key={item.type} value={item.type}>{item.title}</option>)}
              </select>

              <div className="rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.03] p-4">
                <p className="text-xs font-semibold text-cyan-200">{selected.title}</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">{selected.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selected.scopes.map((scope) => (
                    <span key={scope} className="rounded-full border border-white/10 px-2 py-1 text-[9px] text-slate-500">{scope.replaceAll("_", " ")}</span>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/10 p-3 text-[10px] leading-5 text-slate-600">
                The integration will remain <strong className="text-amber-300">planned</strong> until an authorized connection is completed. Using the ingestion token activates only the telemetry channel; it does not claim that the external provider account has been authorized.
              </div>

              <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Registering...</> : <><CheckCircle2 className="h-4 w-4" /> Register integration</>}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
