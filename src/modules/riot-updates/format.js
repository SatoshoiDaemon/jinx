import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';
import { normalizeRiotArticleUrl } from './http.js';

export const MAX_TOP_LEVEL_COMPONENTS_PER_MESSAGE = 10;
export const MAX_TOTAL_COMPONENTS_PER_MESSAGE = 40;
// Deixa espaço para controles de navegação na prévia administrativa.
export const MAX_PUBLICATION_COMPONENTS_PER_MESSAGE = 34;
export const MAX_COMPONENTS_PER_MESSAGE = MAX_TOTAL_COMPONENTS_PER_MESSAGE;
export const MAX_TEXT_DISPLAY_LENGTH = 3_800;
const MAX_TEXT_DISPLAYS_PER_CONTAINER = 8;
const ALLOWED_IMAGE_HOSTS = new Set(['cmsassets.rgpub.io', 'wildrift.leagueoflegends.com']);

const CATEGORY_LABELS = Object.freeze({
  CHAMPION_BALANCE: 'Campeão',
  ITEM_BALANCE: 'Item',
  RUNE_BALANCE: 'Runa',
  SYSTEM_BALANCE: 'Sistema',
  NEW_CHAMPION: 'Novo campeão',
  SKIN_RELEASE: 'Skin',
  EVENT: 'Evento',
  GAME_MODE: 'Modo de jogo',
  BATTLE_PASS: 'Passe',
  MAJOR_ANNOUNCEMENT: 'Grande atualização',
  ARTICLE_RETIFICATION: 'Retificação',
});

function safeImage(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(url.hostname) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function splitText(value, maxLength = MAX_TEXT_DISPLAY_LENGTH) {
  let rest = String(value ?? '').trim();
  const chunks = [];
  while (rest.length > maxLength) {
    let boundary = rest.lastIndexOf('\n', maxLength);
    if (boundary < Math.floor(maxLength / 2)) boundary = rest.lastIndexOf(' ', maxLength);
    if (boundary < Math.floor(maxLength / 2)) boundary = maxLength;
    if (rest.charCodeAt(boundary - 1) >= 0xd800 && rest.charCodeAt(boundary - 1) <= 0xdbff) boundary -= 1;
    chunks.push(rest.slice(0, boundary).trim());
    rest = rest.slice(boundary).trim();
  }
  if (rest || chunks.length === 0) chunks.push(rest);
  return chunks;
}

function displayDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(date);
}

function articleHeader(article, pipeline, marker, pageNumber = 1) {
  const title = article.title || 'Atualização do Wild Rift';
  const details = [
    `# ${title}`,
    article.version ? `**Versão:** ${article.version}` : null,
    displayDate(article.publishedAt) ? `**Data de publicação:** ${displayDate(article.publishedAt)} (UTC)` : null,
    article.summary ? article.summary : null,
    `[Artigo original](${normalizeRiotArticleUrl(article.canonicalUrl) ?? article.canonicalUrl})`,
    article.revision > 0 ? '**Retificação: a Riot alterou este artigo após a publicação anterior.**' : null,
    `Ref. \`WR:${marker}:${pageNumber}\`${pageNumber > 1 ? ` · continuação ${pageNumber}` : ''}`,
  ].filter(Boolean);
  if (pipeline === 'updates' && article.version && /^\d+\.\d+$/u.test(article.version)) {
    details.splice(1, 0, '**Conteúdo anunciado da atualização principal**');
  }
  return details.join('\n\n');
}

function itemText(item) {
  const categories = [...new Set(item.categories ?? (item.category ? [item.category] : []))];
  const parts = [
    `## ${item.name || 'Conteúdo oficial'}`,
    categories.length ? `**Categoria:** ${categories.map((category) => CATEGORY_LABELS[category] ?? category).join(' · ')}` : null,
    item.availability ? `**Situação no artigo:** ${item.availability}` : null,
    item.classification ? `**Classificação:** ${item.classification}` : null,
    item.description || item.originalText || null,
  ].filter(Boolean);

  if (item.skills?.length) {
    parts.push('**Habilidades alteradas**');
    const skillValueLines = new Set();
    for (const skill of item.skills) {
      parts.push(`**${skill.name}**`);
      if (skill.description) parts.push(skill.description);
      if (skill.values?.length) {
        const lines = skill.values.map((value) => value.raw).filter(Boolean);
        lines.forEach((line) => skillValueLines.add(line));
        if (lines.length) parts.push(lines.map((line) => `• ${line}`).join('\n'));
      }
    }
    const otherValues = (item.values ?? []).map((value) => value.raw)
      .filter((raw) => raw && !skillValueLines.has(raw));
    if (otherValues.length) {
      parts.push('**Outros valores publicados**');
      parts.push([...new Set(otherValues)].map((line) => `• ${line}`).join('\n'));
    }
  } else if (item.values?.length) {
    parts.push('**Valores publicados**');
    parts.push(item.values.map((value) => value.raw).filter(Boolean).map((line) => `• ${line}`).join('\n'));
  }
  return parts.join('\n\n');
}

function createContainer(text, image = null) {
  const container = new ContainerBuilder();
  const chunks = splitText(text);
  if (chunks.length > MAX_TEXT_DISPLAYS_PER_CONTAINER) {
    throw new Error('RIOT_PUBLICATION_CONTAINER_TOO_LONG');
  }
  for (const chunk of chunks) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk || ' '));
  }
  const imageUrl = safeImage(image);
  if (imageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)),
    );
  }
  return container;
}

function countComponentTree(component) {
  const data = typeof component?.toJSON === 'function' ? component.toJSON() : component;
  if (!data || typeof data !== 'object') return 0;
  let count = Number.isInteger(data.type) ? 1 : 0;
  for (const key of ['components', 'items']) {
    if (Array.isArray(data[key])) {
      count += data[key].reduce((total, child) => total + countComponentTree(child), 0);
    }
  }
  return count;
}

export function buildPublicationMessages(article, pipeline, items, publicationMarker) {
  if (!['patchNotes', 'updates'].includes(pipeline)) throw new Error('RIOT_PUBLICATION_PIPELINE_INVALID');
  const marker = String(publicationMarker ?? '').replace(/[^a-f\d]/giu, '').slice(0, 16).toLowerCase();
  if (!marker) throw new Error('RIOT_PUBLICATION_MARKER_INVALID');

  const itemContainers = items.map((item) => createContainer(itemText(item), item.image));
  const pages = [];
  let currentPage = [];
  let currentPageComponentCount = countComponentTree(
    createContainer(articleHeader(article, pipeline, marker, 1), article.heroImage),
  );
  for (const container of itemContainers) {
    const componentCount = countComponentTree(container);
    const exceedsTopLevelLimit = currentPage.length + 2 > MAX_TOP_LEVEL_COMPONENTS_PER_MESSAGE;
    const exceedsTotalLimit = currentPageComponentCount + componentCount > MAX_PUBLICATION_COMPONENTS_PER_MESSAGE;
    if (currentPage.length && (exceedsTopLevelLimit || exceedsTotalLimit)) {
      pages.push(currentPage);
      currentPage = [];
      currentPageComponentCount = countComponentTree(
        createContainer(articleHeader(article, pipeline, marker, pages.length + 1), null),
      );
    }
    if (currentPageComponentCount + componentCount > MAX_PUBLICATION_COMPONENTS_PER_MESSAGE) {
      throw new Error('RIOT_PUBLICATION_COMPONENT_LIMIT');
    }
    currentPage.push(container);
    currentPageComponentCount += componentCount;
  }
  pages.push(currentPage);

  const totalPages = pages.length;
  return pages.map((pageItems, index) => {
    const components = [createContainer(articleHeader(article, pipeline, marker, index + 1), index === 0 ? article.heroImage : null), ...pageItems];
    const totalComponents = components.reduce((total, component) => total + countComponentTree(component), 0);
    if (
      components.length > MAX_TOP_LEVEL_COMPONENTS_PER_MESSAGE
      || totalComponents > MAX_PUBLICATION_COMPONENTS_PER_MESSAGE
    ) throw new Error('RIOT_PUBLICATION_COMPONENT_LIMIT');
    return {
      components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [], roles: [], users: [] },
      page: index + 1,
      totalPages,
      itemsInPage: pageItems.length,
      marker: `WR:${marker}:${index + 1}`,
    };
  });
}

export function buildPreviewMessage(article, pipeline, items, publicationMarker) {
  const messages = buildPublicationMessages(article, pipeline, items, publicationMarker);
  return {
    ...messages[0],
    allowedMentions: { parse: [], roles: [], users: [] },
    omittedItems: Math.max(0, items.length - (messages[0].itemsInPage ?? 0)),
  };
}

export function buildWebhookPayload(message, roleId = null) {
  const allowedMentions = roleId && /^\d{17,20}$/u.test(String(roleId))
    ? { parse: [], roles: [String(roleId)], users: [] }
    : { parse: [], roles: [], users: [] };
  const components = [...message.components];
  if (roleId && /^\d{17,20}$/u.test(String(roleId))) {
    const header = new ContainerBuilder(components[0].toJSON());
    header.addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${roleId}>`));
    components[0] = header;
  }
  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions,
  };
}

export function isComponentsV2Message(message) {
  return Boolean((message?.flags ?? 0) & MessageFlags.IsComponentsV2)
    && Array.isArray(message.components)
    && message.components.every((component) => (component?.toJSON?.() ?? component)?.type === 17);
}

export function containsPublicationMarker(message, marker) {
  const target = String(marker ?? '');
  if (!target) return false;
  const visit = (component) => {
    if (typeof component?.content === 'string' && component.content.includes(target)) return true;
    return (component?.components ?? []).some(visit);
  };
  return (message?.components ?? []).some(visit);
}
