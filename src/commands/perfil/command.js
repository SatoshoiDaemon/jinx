import { MediaGalleryBuilder, SlashCommandBuilder } from 'discord.js';
import { editReplyV2, replyV2 } from '../../modules/common/components-v2.js';
import { escapeDiscordText } from '../../modules/common/format.js';

async function fetchGuildMember(guild, userId) {
  try {
    return await guild.members.fetch({ user: userId, force: true });
  } catch (error) {
    if (Number(error?.code) === 10007) {
      return null;
    }
    throw error;
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Mostra informações básicas e o banner público de um membro')
    .addUserOption((option) => option
      .setName('membro')
      .setDescription('Membro que deseja consultar')
      .setRequired(false)),

  async execute(interaction) {
    const selectedUser = interaction.options.getUser('membro') ?? interaction.user;
    await replyV2(interaction, 'Buscando as informações do perfil…');

    const [user, member] = await Promise.all([
      interaction.client.users.fetch(selectedUser.id, { force: true }),
      fetchGuildMember(interaction.guild, selectedUser.id),
    ]);
    const displayName = escapeDiscordText(user.globalName ?? user.username);
    const joinedAt = member?.joinedAt
      ? member.joinedAt.toLocaleDateString('pt-BR', { dateStyle: 'long' })
      : 'não é membro desta guilda';
    const createdAt = user.createdAt.toLocaleDateString('pt-BR', { dateStyle: 'long' });
    const bannerUrl = user.bannerURL({ size: 1024 });
    const media = bannerUrl
      ? [new MediaGalleryBuilder().addItems({
        media: { url: bannerUrl },
        description: `Banner de ${displayName}`,
      })]
      : [];
    const bannerText = bannerUrl ? '' : '\nBanner: este membro não tem banner público.';

    await editReplyV2(
      interaction,
      `## Perfil de ${displayName}\n\nUsuário: \`${escapeDiscordText(user.username)}\`\nID: \`${user.id}\`\nConta criada: ${createdAt}\nEntrada na guilda: ${joinedAt}${bannerText}`,
      { media },
    );
  },
};
