import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel
} from 'discord.js';
import { DBContext } from '../db/client.js';
import { ingestUrl } from '../ingest/pipeline.js';
import { answerQuestion } from '../retrieval/search.js';
import { getSettings, updateSettings } from '../db/settings.js';

const commands = [
  new SlashCommandBuilder().setName('ingest').setDescription('Ingest a URL into KB').addStringOption((o) => o.setName('url').setDescription('URL').setRequired(true)),
  new SlashCommandBuilder().setName('askkb').setDescription('Ask the knowledge base').addStringOption((o) => o.setName('question').setDescription('Question').setRequired(true)),
  new SlashCommandBuilder()
    .setName('kbconfig')
    .setDescription('Show or update KB runtime config')
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('Action')
        .setRequired(true)
        .addChoices(
          { name: 'show', value: 'show' },
          { name: 'autosummary-on', value: 'autosummary-on' },
          { name: 'autosummary-off', value: 'autosummary-off' },
          { name: 'set-summary-channel', value: 'set-summary-channel' }
        )
    )
    .addStringOption((o) => o.setName('channel').setDescription('Channel id for set-summary-channel'))
].map((c) => c.toJSON());

function formatSettings(ctx: DBContext): string {
  const s = getSettings(ctx);
  return [
    'KB settings:',
    `- autoSummaryPostEnabled: ${s.autoSummaryPostEnabled}`,
    `- summaryChannelId: ${s.summaryChannelId || '(unset)'}`,
    `- browserRelayFallbackEnabled: ${s.browserRelayFallbackEnabled}`
  ].join('\n');
}

export function applyKbTextCommand(ctx: DBContext, content: string): string | null {
  const trimmed = content.trim();
  if (trimmed === '!kb settings') return formatSettings(ctx);
  if (trimmed === '!kb summary on') {
    updateSettings(ctx, { autoSummaryPostEnabled: true });
    return '✅ Auto-summary posting enabled';
  }
  if (trimmed === '!kb summary off') {
    updateSettings(ctx, { autoSummaryPostEnabled: false });
    return '✅ Auto-summary posting disabled';
  }
  if (trimmed.startsWith('!kb summary channel ')) {
    const raw = trimmed.replace('!kb summary channel ', '').trim();
    const channelId = raw.replace(/[<#>]/g, '');
    if (!channelId) return '⚠️ Provide a valid channel id or mention.';
    updateSettings(ctx, { summaryChannelId: channelId });
    return `✅ Summary channel set to ${channelId}`;
  }
  return null;
}

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

  async function maybePostSummary(summary: string): Promise<void> {
    const settings = getSettings(ctx);
    if (!settings.autoSummaryPostEnabled || !settings.summaryChannelId) return;
    const channel = await client.channels.fetch(settings.summaryChannelId).catch(() => null);
    if (channel && channel.type === ChannelType.GuildText) {
      await (channel as TextChannel).send(summary.slice(0, 1900));
    }
  }

  client.once(Events.ClientReady, (c) => {
    console.log(`Discord bot ready as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ingest') {
      const url = interaction.options.getString('url', true);
      await interaction.reply(`👀 Queued ingestion for ${url}`);
      try {
        const sourceId = await ingestUrl(ctx, url, { onIngested: async ({ summary }) => maybePostSummary(summary) });
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

    if (interaction.commandName === 'kbconfig') {
      const action = interaction.options.getString('action', true);
      if (action === 'show') {
        await interaction.reply(formatSettings(ctx));
      } else if (action === 'autosummary-on') {
        updateSettings(ctx, { autoSummaryPostEnabled: true });
        await interaction.reply('✅ Auto-summary posting enabled');
      } else if (action === 'autosummary-off') {
        updateSettings(ctx, { autoSummaryPostEnabled: false });
        await interaction.reply('✅ Auto-summary posting disabled');
      } else if (action === 'set-summary-channel') {
        const channelId = interaction.options.getString('channel', true).replace(/[<#>]/g, '');
        updateSettings(ctx, { summaryChannelId: channelId });
        await interaction.reply(`✅ Summary channel set to ${channelId}`);
      }
    }
  });

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    const content = msg.content.trim();

    if (content.startsWith('!ingest ')) {
      const url = content.replace('!ingest ', '').trim();
      await msg.react('👀');
      try {
        await ingestUrl(ctx, url, { onIngested: async ({ summary }) => maybePostSummary(summary) });
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

    if (content.startsWith('!kb ')) {
      const result = applyKbTextCommand(ctx, content);
      if (result) await msg.reply(result);
    }
  });

  await client.login(token);
}
