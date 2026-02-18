#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 45_000;

function parseArgs(argv) {
  const args = { url: undefined, timeoutMs: DEFAULT_TIMEOUT_MS };

  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    if (cur === '--timeout-ms' && argv[i + 1]) {
      args.timeoutMs = Number(argv[i + 1]) || DEFAULT_TIMEOUT_MS;
      i += 1;
      continue;
    }
    if (!args.url && !cur.startsWith('--')) {
      args.url = cur;
      continue;
    }
  }

  return args;
}

function fail(message, details = {}) {
  const err = new Error(message);
  err.details = details;
  throw err;
}

async function callBrowserEndpoint(endpoint, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      fail('OpenClaw browser endpoint returned non-JSON response', { status: res.status, text: text.slice(0, 300) });
    }

    if (!res.ok) {
      fail('OpenClaw browser endpoint request failed', { status: res.status, body: json });
    }

    return json;
  } finally {
    clearTimeout(timer);
  }
}

function pickResult(data) {
  if (data && typeof data === 'object') {
    if ('result' in data) return data.result;
    return data;
  }
  return data;
}

function pickTabId(tabsResult, targetUrl) {
  const tabs = Array.isArray(tabsResult?.tabs) ? tabsResult.tabs : Array.isArray(tabsResult) ? tabsResult : [];
  if (!tabs.length) return null;

  const normalizedTarget = (() => {
    try {
      return new URL(targetUrl).hostname;
    } catch {
      return targetUrl;
    }
  })();

  const match = tabs.find((t) => typeof t?.url === 'string' && t.url.includes(normalizedTarget));
  const selected = match || tabs[0];
  return selected?.id || selected?.targetId || null;
}

function extractEvaluatePayload(payload) {
  const result = pickResult(payload);

  if (result && typeof result === 'object') {
    if (result.value && typeof result.value === 'object') return result.value;
    if (result.result && typeof result.result === 'object') return result.result;
    if (result.output && typeof result.output === 'object') return result.output;
  }

  return result;
}

async function main() {
  const { url, timeoutMs } = parseArgs(process.argv.slice(2));
  if (!url) {
    fail('Usage: browser-relay-extract.mjs <url> [--timeout-ms <ms>]');
  }

  const endpoint = process.env.OPENCLAW_BROWSER_ENDPOINT || 'http://127.0.0.1:3777/browser';

  let tabId;
  try {
    const tabsResp = await callBrowserEndpoint(endpoint, { action: 'tabs', profile: 'chrome', target: 'host' }, timeoutMs);
    tabId = pickTabId(pickResult(tabsResp), url);
  } catch (err) {
    fail(
      'Could not reach OpenClaw browser endpoint. Ensure OpenClaw is running and OPENCLAW_BROWSER_ENDPOINT is correct.',
      { endpoint, cause: String(err?.message || err) }
    );
  }

  if (!tabId) {
    fail(
      'No attached Chrome relay tab was found. Open Chrome, click the OpenClaw Browser Relay toolbar icon on a tab (badge ON), then retry.',
      { endpoint }
    );
  }

  await callBrowserEndpoint(
    endpoint,
    { action: 'navigate', profile: 'chrome', target: 'host', targetId: tabId, targetUrl: url },
    timeoutMs
  );

  const evalResp = await callBrowserEndpoint(
    endpoint,
    {
      action: 'act',
      profile: 'chrome',
      target: 'host',
      targetId: tabId,
      request: {
        kind: 'evaluate',
        targetId: tabId,
        fn: `() => {
          const title = document.title || '';
          const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
          return {
            title,
            text,
            metadata: {
              url: location.href,
              byline: document.querySelector('meta[name="author"]')?.getAttribute('content') || null,
              source: 'openclaw-browser-relay'
            }
          };
        }`
      }
    },
    timeoutMs
  );

  const extracted = extractEvaluatePayload(evalResp);
  const text = typeof extracted?.text === 'string' ? extracted.text.trim() : '';
  if (!text) {
    fail('Relay extraction succeeded but returned empty text. Ensure the page is fully loaded and accessible in the attached tab.', {
      url,
      tabId
    });
  }

  const output = {
    title: typeof extracted?.title === 'string' ? extracted.title : '',
    text,
    metadata: {
      ...(extracted?.metadata && typeof extracted.metadata === 'object' ? extracted.metadata : {}),
      endpoint,
      tabId
    },
    confidence: 0.72
  };

  process.stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch((err) => {
  const message = err?.message || String(err);
  const details = err?.details && typeof err.details === 'object' ? err.details : undefined;
  process.stderr.write(`[browser-relay-extract] ${message}${details ? `\n${JSON.stringify(details)}` : ''}\n`);
  process.exit(1);
});
