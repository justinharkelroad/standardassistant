export interface KBSettings {
  autoSummaryPostEnabled: boolean;
  summaryChannelId: string | null;
  browserRelayFallbackEnabled: boolean;
}

export const DEFAULT_SETTINGS: KBSettings = {
  autoSummaryPostEnabled: (process.env.KB_AUTO_SUMMARY_POST_ENABLED || 'false').toLowerCase() === 'true',
  summaryChannelId: process.env.KB_SUMMARY_CHANNEL_ID || null,
  browserRelayFallbackEnabled: (process.env.KB_BROWSER_RELAY_FALLBACK_ENABLED || 'false').toLowerCase() === 'true'
};
