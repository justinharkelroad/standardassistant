import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractViaBrowserRelay } from '../src/ingest/extractors.js';

const scriptPath = new URL('../scripts/browser-relay-extract.mjs', import.meta.url);
const execFileAsync = promisify(execFile);

async function runScript(url: string, env: Record<string, string>) {
  try {
    const out = await execFileAsync('node', [scriptPath.pathname, url], {
      env: { ...process.env, ...env },
      encoding: 'utf8'
    });
    return { status: 0, stdout: out.stdout, stderr: out.stderr };
  } catch (error: any) {
    return { status: error?.code ?? 1, stdout: error?.stdout || '', stderr: error?.stderr || String(error?.message || error) };
  }
}

function jsonResponse(res: ServerResponse, body: unknown) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

describe('browser-relay extractor script', () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanup.length) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    delete process.env.KB_BROWSER_RELAY_EXTRACT_CMD;
    delete process.env.OPENCLAW_BROWSER_ENDPOINT;
  });

  it('emits JSON contract {title,text,metadata,confidence}', async () => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));

      if (payload.action === 'tabs') {
        return jsonResponse(res, { tabs: [{ id: 'tab-1', url: 'https://example.com' }] });
      }
      if (payload.action === 'navigate') {
        return jsonResponse(res, { ok: true });
      }
      if (payload.action === 'act') {
        return jsonResponse(res, {
          result: {
            value: {
              title: 'Example Title',
              text: 'Extracted body text from relay session.',
              metadata: { source: 'mock' }
            }
          }
        });
      }

      return jsonResponse(res, {});
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    cleanup.push(() => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))));

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Could not resolve test server address');

    const result = await runScript('https://example.com/article', {
      OPENCLAW_BROWSER_ENDPOINT: `http://127.0.0.1:${addr.port}/browser`
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toMatchObject({
      title: 'Example Title',
      text: 'Extracted body text from relay session.',
      confidence: expect.any(Number),
      metadata: expect.any(Object)
    });
  });

  it('fails with actionable message when relay endpoint is unavailable', async () => {
    const result = await runScript('https://example.com/article', {
      OPENCLAW_BROWSER_ENDPOINT: 'http://127.0.0.1:1/browser'
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Could not reach OpenClaw browser endpoint');
  });

  it('extractViaBrowserRelay surfaces extractor failure details', async () => {
    process.env.KB_BROWSER_RELAY_EXTRACT_CMD = scriptPath.pathname;
    process.env.OPENCLAW_BROWSER_ENDPOINT = 'http://127.0.0.1:1/browser';

    await expect(extractViaBrowserRelay('https://example.com')).rejects.toThrow(/Browser relay extractor failed/i);
  });
});
