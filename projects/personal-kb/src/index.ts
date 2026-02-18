import 'dotenv/config';
import { initDB } from './db/client.js';
import { ingestUrl } from './ingest/pipeline.js';
import { answerQuestion } from './retrieval/search.js';
import { registerCommands, startDiscordBot } from './discord/bot.js';
import { healthStatus } from './observability.js';
import { getSettings, updateSettings } from './db/settings.js';

async function main() {
  const ctx = initDB(process.env.KB_DB_PATH);

  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === 'ingest' && rest[0]) {
    const sourceId = await ingestUrl(ctx, rest[0]);
    console.log(`Ingested source #${sourceId}`);
    return;
  }

  if (cmd === 'ask' && rest.length) {
    const q = rest.join(' ');
    const ans = await answerQuestion(ctx, q);
    console.log(ans);
    return;
  }

  if (cmd === 'status') {
    console.log(JSON.stringify({ health: healthStatus(ctx), settings: getSettings(ctx) }, null, 2));
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
  console.log('  npm run dev -- ingest <url>');
  console.log('  npm run dev -- ask <question>');
  console.log('  npm run dev -- status');
  console.log('  npm run dev -- config set <autoSummaryPostEnabled|summaryChannelId|browserRelayFallbackEnabled> <value>');
  console.log('  npm run dev -- discord');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
