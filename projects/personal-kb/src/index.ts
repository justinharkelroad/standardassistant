import 'dotenv/config';
import { initDB } from './db/client.js';
import { ingestUrl } from './ingest/pipeline.js';
import { answerQuestion } from './retrieval/search.js';
import { registerCommands, startDiscordBot } from './discord/bot.js';

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

  if (cmd === 'discord') {
    await registerCommands();
    await startDiscordBot(ctx);
    return;
  }

  console.log('Usage:');
  console.log('  npm run dev -- ingest <url>');
  console.log('  npm run dev -- ask <question>');
  console.log('  npm run dev -- discord');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
