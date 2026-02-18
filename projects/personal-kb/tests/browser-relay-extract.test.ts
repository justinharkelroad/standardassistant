import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-browser-relay-'));
  });

  afterEach(async () => {
    while (cleanup.length) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KB_BROWSER_RELAY_EXTRACT_CMD;
    delete process.env.OPENCLAW_BROWSER_ENDPOINT;
    delete process.env.OPENCLAW_BROWSER_CMD;
  });

  it('emits JSON contract via endpoint mode {title,text,metadata,confidence}', async () => {
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
    expect(parsed.metadata.transport).toBe('endpoint');
  });

  it('uses local CLI transport when OPENCLAW_BROWSER_ENDPOINT is invalid', async () => {
    const fakeCmd = path.join(tmpDir, 'openclaw');
    const stateFile = path.join(tmpDir, 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify({ calls: [] }), 'utf8');
    fs.writeFileSync(
      fakeCmd,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const stateFile = process.env.FAKE_OPENCLAW_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
state.calls.push(args);
fs.writeFileSync(stateFile, JSON.stringify(state));

const cmd = args[4]; // browser --json --browser-profile chrome <cmd>
if (cmd === 'tabs') {
  process.stdout.write(JSON.stringify({ tabs: [{ id: 'tab-9', url: 'https://example.com/start' }] }));
  process.exit(0);
}
if (cmd === 'navigate') {
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}
if (cmd === 'evaluate') {
  process.stdout.write(JSON.stringify({ value: { title: 'CLI Title', text: 'CLI extracted text', metadata: { source: 'fake-cli' } } }));
  process.exit(0);
}
process.stdout.write('{}');
`,
      'utf8'
    );
    fs.chmodSync(fakeCmd, 0o755);

    const result = await runScript('https://example.com/article', {
      OPENCLAW_BROWSER_ENDPOINT: 'not-a-url',
      OPENCLAW_BROWSER_CMD: fakeCmd,
      FAKE_OPENCLAW_STATE: stateFile
    });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.title).toBe('CLI Title');
    expect(parsed.metadata.transport).toBe('cli');

    const calls = JSON.parse(fs.readFileSync(stateFile, 'utf8')).calls as string[][];
    expect(calls.some((a) => a.includes('tabs'))).toBe(true);
    expect(calls.some((a) => a.includes('navigate'))).toBe(true);
    expect(calls.some((a) => a.includes('evaluate'))).toBe(true);
  });

  it('fails with actionable message when configured endpoint is unavailable', async () => {
    const result = await runScript('https://example.com/article', {
      OPENCLAW_BROWSER_ENDPOINT: 'http://127.0.0.1:1/browser'
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Could not reach configured OpenClaw browser endpoint');
  });

  it('extractViaBrowserRelay surfaces extractor failure details', async () => {
    process.env.KB_BROWSER_RELAY_EXTRACT_CMD = scriptPath.pathname;
    process.env.OPENCLAW_BROWSER_ENDPOINT = 'http://127.0.0.1:1/browser';

    await expect(extractViaBrowserRelay('https://example.com')).rejects.toThrow(/Browser relay extractor failed/i);
  });
});
