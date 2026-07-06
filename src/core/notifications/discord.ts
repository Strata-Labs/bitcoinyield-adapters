import type {
  Notifier,
  SpikeAlert,
  BoundaryAlert,
  StalenessAlert,
  RegressionAlert,
} from "../types.js";

export interface DiscordWebhooks {
  spike?: string;
  /** Used for boundary + staleness + regression alerts. */
  outages?: string;
  /** Catch-all when a specific channel isn't configured. */
  fallback?: string;
}

export class DiscordNotifier implements Notifier {
  private webhooks: DiscordWebhooks;

  constructor(webhooks: DiscordWebhooks = {}) {
    this.webhooks = {
      ...webhooks,
      fallback: webhooks.fallback ?? process.env.BITCOINYIELD_DISCORD_WEBHOOK,
    };
  }

  async spike(alert: SpikeAlert): Promise<void> {
    const arrow = alert.direction === "up" ? "⬆" : "⬇";
    const msg =
      `${arrow} SPIKE [${alert.adapter}] ` +
      `${alert.field}: ${formatNum(alert.oldValue)} → ${formatNum(alert.newValue)} ` +
      `(${alert.multiplier.toFixed(2)}x ${alert.direction})`;
    await this.send(this.webhooks.spike ?? this.webhooks.fallback, msg);
  }

  async boundary(alert: BoundaryAlert): Promise<void> {
    const direction = alert.bound === "lower" ? "below" : "above";
    const msg =
      `🚫 BOUNDARY [${alert.adapter}] ` +
      `${alert.field}=${formatNum(alert.value)} ${direction} ${alert.bound} bound ${formatNum(alert.threshold)}`;
    await this.send(this.webhooks.outages ?? this.webhooks.fallback, msg);
  }

  async staleness(alert: StalenessAlert): Promise<void> {
    const msg =
      `🕐 STALE [${alert.adapter}] no update in ${alert.hoursSilent.toFixed(1)}h ` +
      `(last: ${alert.lastUpdateAt.toISOString()})`;
    await this.send(this.webhooks.outages ?? this.webhooks.fallback, msg);
  }

  async regression(alert: RegressionAlert): Promise<void> {
    const msg =
      `✗ REGRESSION [${alert.adapter}] ${alert.consecutiveFailures} consecutive failures\n` +
      `Last error: ${alert.lastError.slice(0, 500)}`;
    await this.send(this.webhooks.outages ?? this.webhooks.fallback, msg);
  }

  // Auto-splits when wrapped message exceeds Discord's 2000-char limit.
  // Splits on newlines first, then char boundaries — matters for stack
  // traces with no internal newlines.
  private async send(
    webhook: string | undefined,
    message: string,
  ): Promise<void> {
    if (!webhook) return;

    const wrapped = "```\n" + message + "\n```";
    if (wrapped.length < 2000) {
      await this.post(webhook, wrapped);
      return;
    }

    const lines = message.split("\n");
    if (lines.length > 1) {
      const mid = Math.ceil(lines.length / 2);
      await this.send(webhook, lines.slice(0, mid).join("\n"));
      await this.send(webhook, lines.slice(mid).join("\n"));
      return;
    }

    const chunkSize = 1900;
    for (let i = 0; i < message.length; i += chunkSize) {
      await this.send(webhook, message.slice(i, i + chunkSize));
    }
  }

  private async post(webhook: string, content: string): Promise<void> {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        // A revoked webhook (401/404) or rate limit (429) must be visible in
        // logs — otherwise paging dies silently on the channel that's supposed
        // to work even when everything else is down.
        const body = await res.text().catch(() => "");
        // eslint-disable-next-line no-console
        console.error(
          `[DiscordNotifier] webhook returned HTTP ${res.status}: ${body.slice(0, 200)}`,
        );
      }
    } catch (err) {
      // Notifier failures must never break the main pipeline.
      // eslint-disable-next-line no-console
      console.error("[DiscordNotifier] send failed:", err);
    }
  }
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(4);
}
