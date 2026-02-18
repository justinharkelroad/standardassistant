import { describe, it, expect } from 'vitest';
import { shouldUseBrowserRelayFallback } from '../src/ingest/extractors.js';
import { initDB } from '../src/db/client.js';
import { applyKbTextCommand } from '../src/discord/bot.js';
import { getSettings } from '../src/db/settings.js';

describe('phase3: fallback routing', () => {
  it('uses browser relay when enabled and readable text is insufficient', () => {
    expect(
      shouldUseBrowserRelayFallback({
        enabled: true,
        status: 200,
        html: '<html><body>tiny</body></html>',
        readableTextLength: 10,
        minReadableChars: 300
      })
    ).toBe(true);
  });

  it('uses browser relay for paywalled responses', () => {
    expect(
      shouldUseBrowserRelayFallback({
        enabled: true,
        status: 403,
        html: '<html><body>forbidden</body></html>',
        readableTextLength: 1200,
        minReadableChars: 300
      })
    ).toBe(true);
  });

  it('does not use browser relay when disabled', () => {
    expect(
      shouldUseBrowserRelayFallback({
        enabled: false,
        status: 403,
        html: '<html><body>paywall</body></html>',
        readableTextLength: 0,
        minReadableChars: 300
      })
    ).toBe(false);
  });
});

describe('phase3: summary posting config commands', () => {
  it('toggles auto-summary posting and sets channel', () => {
    const ctx = initDB(':memory:');

    expect(applyKbTextCommand(ctx, '!kb summary on')).toContain('enabled');
    expect(getSettings(ctx).autoSummaryPostEnabled).toBe(true);

    expect(applyKbTextCommand(ctx, '!kb summary channel <#1234567890>')).toContain('1234567890');
    expect(getSettings(ctx).summaryChannelId).toBe('1234567890');

    expect(applyKbTextCommand(ctx, '!kb summary off')).toContain('disabled');
    expect(getSettings(ctx).autoSummaryPostEnabled).toBe(false);
  });
});
