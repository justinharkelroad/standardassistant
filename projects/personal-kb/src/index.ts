import 'dotenv/config';
import { initDB } from './db/client.js';
import { ingestUrl } from './ingest/pipeline.js';
import { answerQuestion } from './retrieval/search.js';
import { registerCommands, startDiscordBot } from './discord/bot.js';
import { healthStatus } from './observability.js';
import { getSettings, updateSettings } from './db/settings.js';
import { AskFilters, SourceType } from './types.js';

const VALID_SOURCE_TYPES: SourceType[] = ['article', 'pdf', 'youtube', 'twitter', 'tiktok'];

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[args[i].slice(2)] = args[i + 1];
      i += 2;
    } else {
      positional.push(args[i]);
      i++;
    }
  }
  return { positional, flags };
}

async function main() {
  const ctx = initDB(process.env.KB_DB_PATH);

  const rawArgs = process.argv.slice(2);
  const cmd = rawArgs[0];
  const rest = rawArgs.slice(1);

  if (cmd === 'ingest') {
    const { positional, flags } = parseFlags(rest);
    const url = positional[0];
    if (!url) {
      console.error('Error: URL required.\nUsage: npm run dev -- ingest <url> [--collection <name>]');
      process.exit(1);
    }
    const collection = flags.collection;
    const sourceId = await ingestUrl(ctx, url, { collection });
    console.log(`Ingested source #${sourceId}${collection ? ` into collection "${collection}"` : ''}`);
    return;
  }

  if (cmd === 'ask') {
    const { positional, flags } = parseFlags(rest);
    const question = positional.join(' ');
    if (!question) {
      console.error('Error: Question required.\nUsage: npm run dev -- ask "<question>" [--collection <name>] [--domain <domain>] [--source <type>] [--url <url>]');
      process.exit(1);
    }

    // Validate --source flag
    if (flags.source && !VALID_SOURCE_TYPES.includes(flags.source as SourceType)) {
      console.error(`Error: Invalid source type "${flags.source}". Valid types: ${VALID_SOURCE_TYPES.join(', ')}`);
      process.exit(1);
    }

    const filters: AskFilters = {};
    if (flags.collection) filters.collection = flags.collection;
    if (flags.domain) filters.domain = flags.domain;
    if (flags.source) filters.source = flags.source as SourceType;
    if (flags.url) filters.url = flags.url;

    const ans = await answerQuestion(ctx, question, Object.keys(filters).length > 0 ? filters : undefined);
    console.log(ans);
    return;
  }

  if (cmd === 'status') {
    const health = healthStatus(ctx);

    // Collection breakdown
    const collectionCounts = ctx.db
      .prepare('SELECT collection, COUNT(*) as count FROM sources GROUP BY collection ORDER BY count DESC')
      .all() as Array<{ collection: string; count: number }>;

    // Source type breakdown
    const typeCounts = ctx.db
      .prepare('SELECT type, COUNT(*) as count FROM sources GROUP BY type ORDER BY count DESC')
      .all() as Array<{ type: string; count: number }>;

    console.log(JSON.stringify({
      health,
      settings: getSettings(ctx),
      collections: collectionCounts,
      sourceTypes: typeCounts
    }, null, 2));
    return;
  }

  if (cmd === 'collections') {
    const rows = ctx.db
      .prepare(
        `SELECT s.collection,
                COUNT(DISTINCT s.id) AS source_count,
                COUNT(c.id) AS chunk_count
         FROM sources s
         LEFT JOIN chunks c ON c.source_id = s.id
         GROUP BY s.collection
         ORDER BY source_count DESC`
      )
      .all() as Array<{ collection: string; source_count: number; chunk_count: number }>;

    if (rows.length === 0) {
      console.log('No collections found. Ingest some content first:');
      console.log('  npm run dev -- ingest <url> --collection <name>');
      return;
    }

    console.log('Collections:\n');
    const maxName = Math.max(10, ...rows.map((r) => r.collection.length));
    console.log(`  ${'Name'.padEnd(maxName)}  Sources  Chunks`);
    console.log(`  ${'─'.repeat(maxName)}  ───────  ──────`);
    for (const row of rows) {
      console.log(`  ${row.collection.padEnd(maxName)}  ${String(row.source_count).padStart(7)}  ${String(row.chunk_count).padStart(6)}`);
    }
    return;
  }

  if (cmd === 'config' && rest[0] === 'set' && rest[1] && rest[2] !== undefined) {
    const key = rest[1];
    const value = rest.slice(2).join(' ');
    if (key === 'autoSummaryPostEnabled') {
      updateSettings(ctx, { autoSummaryPostEnabled: value.toLowerCase() === 'true' });
    } else if (key === 'summaryChannelId') {
      updateSettings(ctx, { summaryChannelId: value === 'null' ? null : value });
    } else if (key === 'browserRelayFallbackEnabled') {
      updateSettings(ctx, { browserRelayFallbackEnabled: value.toLowerCase() === 'true' });
    } else {
      throw new Error(`Unknown config key: ${key}`);
    }
    console.log(JSON.stringify(getSettings(ctx), null, 2));
    return;
  }

  if (cmd === 'discord') {
    await registerCommands();
    await startDiscordBot(ctx);
    return;
  }

  console.log('Usage:');
  console.log('  npm run dev -- ingest <url> [--collection <name>]');
  console.log('  npm run dev -- ask "<question>" [--collection <name>] [--domain <domain>] [--source <type>] [--url <url>]');
  console.log('  npm run dev -- status');
  console.log('  npm run dev -- collections');
  console.log('  npm run dev -- config set <autoSummaryPostEnabled|summaryChannelId|browserRelayFallbackEnabled> <value>');
  console.log('  npm run dev -- discord');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
