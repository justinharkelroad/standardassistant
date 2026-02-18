export interface KBSettings {
  autoSummaryPostEnabled: boolean;
  summaryChannelId: string | null;
  browserRelayFallbackEnabled: boolean;
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_BROWSER_RELAY_SCRIPT_PATH = join(process.cwd(), 'scripts', 'browser-relay-extract.mjs');

export const resolveBrowserRelayExtractCmd = (): string | null => {
  const configured = process.env.KB_BROWSER_RELAY_EXTRACT_CMD?.trim();
  if (configured) return configured;
  return existsSync(DEFAULT_BROWSER_RELAY_SCRIPT_PATH) ? DEFAULT_BROWSER_RELAY_SCRIPT_PATH : null;
};

export const DEFAULT_SETTINGS: KBSettings = {
  autoSummaryPostEnabled: (process.env.KB_AUTO_SUMMARY_POST_ENABLED || 'false').toLowerCase() === 'true',
  summaryChannelId: process.env.KB_SUMMARY_CHANNEL_ID || null,
  browserRelayFallbackEnabled: (process.env.KB_BROWSER_RELAY_FALLBACK_ENABLED || 'false').toLowerCase() === 'true'
};
