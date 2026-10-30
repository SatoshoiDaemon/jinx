import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

function numberInput(customId, label, value, { required = true, placeholder = String(value) } = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(placeholder)
    .setRequired(required)
    .setMaxLength(16);

  if (required) {
    input.setValue(String(value));
  }
  return new ActionRowBuilder().addComponents(input);
}

export function buildPanelRows() {
  const settingsButton = new ButtonBuilder()
    .setCustomId('panel:settings')
    .setLabel('Ajustar XP e curva')
    .setStyle(ButtonStyle.Primary);
  const boostLimitButton = new ButtonBuilder()
    .setCustomId('panel:boost-limit')
    .setLabel('Limite de boosts')
    .setStyle(ButtonStyle.Secondary);
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('panel:role')
    .setPlaceholder('Escolha um cargo para configurar o boost')
    .setMinValues(1)
    .setMaxValues(1);
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('panel:channel')
    .setPlaceholder('Escolha um canal para configurar o boost')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);

  return [
    new ActionRowBuilder().addComponents(settingsButton, boostLimitButton),
    new ActionRowBuilder().addComponents(roleSelect),
    new ActionRowBuilder().addComponents(channelSelect),
  ];
}

export function buildSettingsModal() {
  return new ModalBuilder()
    .setCustomId('panel:modal:settings')
    .setTitle('Configurações de XP')
    .addComponents(
      numberInput('xpBase', 'XP base para o próximo nível', '', { required: false, placeholder: 'Em branco mantém atual' }),
      numberInput('xpStep', 'Aumento por nível', '', { required: false, placeholder: 'Em branco mantém atual' }),
      numberInput('xpMin', 'XP mínimo por mensagem', '', { required: false, placeholder: 'Em branco mantém atual' }),
      numberInput('xpMax', 'XP máximo por mensagem', '', { required: false, placeholder: 'Em branco mantém atual' }),
      numberInput('cooldownSeconds', 'Cooldown em segundos', '', { required: false, placeholder: 'Em branco mantém atual' }),
    );
}

export function buildBoostLimitModal() {
  return new ModalBuilder()
    .setCustomId('panel:modal:boost-limit')
    .setTitle('Limite de boosts')
    .addComponents(
      numberInput('maxBoostMultiplier', 'Multiplicador máximo por boost', '', {
        required: false,
        placeholder: 'Em branco mantém atual',
      }),
    );
}

export function buildBoostModal(kind, targetId) {
  const label = kind === 'role' ? 'cargo' : 'canal';
  const input = new TextInputBuilder()
    .setCustomId('multiplier')
    .setLabel(`Multiplicador do ${label}`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Informe um número; 0 remove o boost')
    .setRequired(true)
    .setMaxLength(16);

  return new ModalBuilder()
    .setCustomId(`panel:modal:${kind}:${targetId}`)
    .setTitle(`Configurar boost de ${label}`)
    .addComponents(new ActionRowBuilder().addComponents(input));
}
