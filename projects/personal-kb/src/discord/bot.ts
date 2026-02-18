import { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { DBContext } from '../db/client.js';
import { ingestUrl } from '../ingest/pipeline.js';
import { answerQuestion } from '../retrieval/search.js';

const commands = [
  new SlashCommandBuilder().setName('ingest').setDescription('Ingest a URL into KB').addStringOption((o) => o.setName('url').setDescription('URL').setRequired(true)),
  new SlashCommandBuilder().setName('askkb').setDescription('Ask the knowledge base').addStringOption((o) => o.setName('question').setDescription('Question').setRequired(true))
].map((c) => c.toJSON());

export async function registerCommands(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !clientId || !guildId) return;

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
}

export async function startDiscordBot(ctx: DBContext): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

  client.once(Events.ClientReady, (c) => {
    console.log(`Discord bot ready as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ingest') {
      const url = interaction.options.getString('url', true);
      await interaction.reply(`👀 Queued ingestion for ${url}`);
      try {
        const sourceId = await ingestUrl(ctx, url);
        await interaction.followUp(`✅ Ingested source #${sourceId}`);
      } catch (e) {
        await interaction.followUp(`⚠️ Failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (interaction.commandName === 'askkb') {
      const question = interaction.options.getString('question', true);
      await interaction.deferReply();
      const answer = await answerQuestion(ctx, question);
      await interaction.editReply(answer.slice(0, 1900));
    }
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    const content = msg.content.trim();

    if (content.startsWith('!ingest ')) {
      const url = content.replace('!ingest ', '').trim();
      await msg.react('👀');
      try {
        await ingestUrl(ctx, url);
        await msg.react('✅');
      } catch {
        await msg.react('⚠️');
      }
    }

    if (content.startsWith('!askkb ')) {
      const question = content.replace('!askkb ', '').trim();
      const answer = await answerQuestion(ctx, question);
      await msg.reply(answer.slice(0, 1900));
    }
  });

  await client.login(token);
}
