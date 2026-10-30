import { createHash } from 'node:crypto';
import { normalizeRiotArticleUrl } from './http.js';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const BLOCK_TAGS = new Set(['address', 'article', 'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ol', 'p', 'section', 'table', 'tr', 'ul']);
const MAX_ENTRIES_PER_SECTION = 200;
const MAX_TOTAL_ARTICLE_ENTRIES = 1_000;
const ENTITY_NAMES = Object.freeze({
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', copy: '©', reg: '®',
});

function decodeEntities(value) {
  return String(value ?? '').replace(/&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/giu, (entity, name) => {
    if (name[0] === '#') {
      const hexadecimal = name[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      } catch {
        return entity;
      }
    }
    return ENTITY_NAMES[name.toLowerCase()] ?? entity;
  });
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu;
  let match;
  while ((match = pattern.exec(source))) {
    const key = match[1].toLowerCase();
    if (key.startsWith('<') || key === '/') continue;
    attributes[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

function parseHtml(html) {
  const root = { tag: '#document', attrs: {}, children: [], parent: null, text: '' };
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+/giu;
  let match;
  while ((match = tokens.exec(html))) {
    const token = match[0];
    if (token.startsWith('<!--') || /^<!/u.test(token)) continue;
    if (token.startsWith('</')) {
      const tag = /^<\/\s*([a-z0-9:-]+)/iu.exec(token)?.[1]?.toLowerCase();
      if (!tag) continue;
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    if (token.startsWith('<')) {
      const tag = /^<\s*([a-z0-9:-]+)/iu.exec(token)?.[1]?.toLowerCase();
      if (!tag) continue;
      const attributeSource = token.slice(tag.length + 1, token.length - 1).replace(/\/\s*$/u, '');
      const element = { tag, attrs: parseAttributes(attributeSource), children: [], parent: stack.at(-1), text: '' };
      stack.at(-1).children.push(element);
      if (!VOID_TAGS.has(tag) && !/\/\s*>$/u.test(token)) stack.push(element);
      continue;
    }
    if (['script', 'style', 'noscript'].includes(stack.at(-1).tag)) continue;
    stack.at(-1).children.push({ tag: '#text', attrs: {}, children: [], parent: stack.at(-1), text: decodeEntities(token) });
  }
  return root;
}

function walk(node, predicate, output = []) {
  for (const child of node.children ?? []) {
    if (predicate(child)) output.push(child);
    walk(child, predicate, output);
  }
  return output;
}

function hasTestIdPrefix(node, prefix) {
  return (node.attrs?.['data-testid'] ?? '').startsWith(prefix);
}

function textOf(node) {
  if (node.tag === '#text') return node.text;
  if (node.tag === 'br') return '\n';
  const content = (node.children ?? []).map(textOf).join('');
  return BLOCK_TAGS.has(node.tag) ? `${content}\n` : content;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r/gu, '')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function nodeText(node) {
  return cleanText(textOf(node));
}

function attribute(node, name) {
  return node?.attrs?.[name.toLowerCase()] ?? null;
}

function findMeta(root, keyName, keyValue) {
  const meta = walk(root, (node) => node.tag === 'meta' && attribute(node, keyName) === keyValue)[0];
  return meta ? attribute(meta, 'content') : null;
}

function validatedImageUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || !['cmsassets.rgpub.io', 'wildrift.leagueoflegends.com'].includes(url.hostname)
      || url.username
      || url.password
    ) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function parseVersion(title, summary = '') {
  const source = `${title ?? ''} ${summary ?? ''}`;
  const match = /(?:patch|notas\s+da\s+atualiza(?:ção|cao)|update|actualización|notas\s+del\s+parche)\s*([0-9]+\.[0-9]+[a-z]?)/iu.exec(source);
  return match?.[1]?.toLowerCase() ?? null;
}

function collectTextBlocks(container, omittedHeading) {
  const output = [];
  let current = null;
  const flush = () => {
    if (current && (current.title || current.text.trim() || current.images.length)) {
      output.push({
        title: current.title,
        text: cleanText(current.text),
        level: current.level,
        image: current.images[0] ?? null,
        images: current.images,
      });
    }
  };
  const startHeading = (title, level = 6) => {
    flush();
    current = { title, text: '', level, images: [] };
  };
  current = { title: null, text: '', images: [] };

  function appendImages(node) {
    for (const image of walk(node, (child) => child.tag === 'img')) {
      const url = validatedImageUrl(attribute(image, 'src') ?? attribute(image, 'data-src'));
      if (url && !current.images.some((existing) => existing.url === url)) {
        current.images.push({ url, alt: attribute(image, 'alt') ?? '' });
      }
    }
  }

  function visit(node) {
    if (node.tag === '#text') {
      const content = node.text.trim();
      if (content) current.text += `${content} `;
      return;
    }
    if (['script', 'style', 'noscript', 'source', 'svg'].includes(node.tag)) return;
    if (node.tag === 'img') {
      const url = validatedImageUrl(attribute(node, 'src') ?? attribute(node, 'data-src'));
      if (url && !current.images.some((existing) => existing.url === url)) {
        current.images.push({ url, alt: attribute(node, 'alt') ?? '' });
      }
      return;
    }
    if (node.tag === 'h1' || node.tag === 'h2' || node.tag === 'h3' || node.tag === 'h4' || node.tag === 'h5' || node.tag === 'h6') {
      const title = nodeText(node);
      if (title && title !== omittedHeading) startHeading(title, Number(node.tag.slice(1)));
      return;
    }
    if (attribute(node, 'data-testid') === 'title') {
      const title = nodeText(node);
      if (title && title !== omittedHeading) startHeading(title, 6);
      return;
    }
    if (['p', 'li', 'blockquote'].includes(node.tag)) {
      appendImages(node);
      const content = nodeText(node);
      if (content) current.text += `${content}\n`;
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }

  visit(container);
  flush();
  return output.filter((item) => item.title || item.text);
}

function sectionTitle(section, sectionId) {
  const headerTitle = walk(section, (node) => attribute(node, 'data-testid') === 'title')[0];
  if (headerTitle && nodeText(headerTitle)) return nodeText(headerTitle);
  if (sectionId) return sectionId;
  const primaryHeading = walk(section, (node) => /^h[1-3]$/u.test(node.tag))[0];
  return primaryHeading ? nodeText(primaryHeading) : 'Seção sem título';
}

function parseSection(section) {
  const id = attribute(section, 'id');
  const title = sectionTitle(section, id);
  const body = walk(section, (node) => attribute(node, 'data-testid') === 'blade-content')[0] ?? section;
  const characterBlocks = walk(body, (node) => node.tag === 'div'
    && hasTestIdPrefix(node, 'character-changes-')
    && (attribute(node, 'class') ?? '').split(/\s+/u).includes('character-changes-container')
    && walk(node, (child) => attribute(child, 'data-testid') === 'character-name').length > 0);
  const characters = characterBlocks.map((node) => {
    const dataTestId = attribute(node, 'data-testid');
    const nameNode = walk(node, (child) => attribute(child, 'data-testid') === 'character-name')[0];
    const name = nameNode ? nodeText(nameNode) : dataTestId.slice('character-changes-'.length).replace(/[-_]+/gu, ' ').trim();
    const image = walk(node, (child) => child.tag === 'img')
      .map((child) => ({ url: validatedImageUrl(attribute(child, 'src')), alt: attribute(child, 'alt') ?? '' }))
      .find((child) => child.url) ?? null;
    const summaryNode = walk(node, (child) => attribute(child, 'data-testid') === 'character-changes-summary')[0];
    const summary = summaryNode ? nodeText(summaryNode) : '';
    const changeBlocks = walk(node, (child) => child.tag === 'div' && /^character-change-\d+$/u.test(attribute(child, 'data-testid') ?? ''));
    const skills = changeBlocks.map((change) => {
      const skillNameNode = walk(change, (child) => attribute(child, 'data-testid') === 'character-ability-title')[0];
      const bodyNode = walk(change, (child) => attribute(child, 'data-testid') === 'character-change-body')[0] ?? change;
      const skillText = nodeText(bodyNode);
      return {
        name: skillNameNode ? nodeText(skillNameNode) : 'Habilidade sem nome',
        text: skillText,
        values: extractValueChanges(skillText),
      };
    });
    const rawText = cleanText([summary, ...skills.map((skill) => `**${skill.name}**\n${skill.text}`)].filter(Boolean).join('\n\n')) || nodeText(node);
    return {
      entityType: 'champion',
      name,
      title: name,
      image,
      summary,
      text: rawText,
      skills,
      values: extractValueChanges(rawText),
    };
  });
  const sectionBlocks = collectTextBlocks(body, title);
  const text = nodeText(body);
  const characterSectionUnparsed = attribute(section, 'data-testid') === 'CharacterChanges' && characters.length === 0;
  const allEntries = characters.length ? characters : characterSectionUnparsed ? [] : sectionBlocks;
  const entries = allEntries.slice(0, MAX_ENTRIES_PER_SECTION);
  return {
    id: id ?? null,
    title,
    text,
    entries,
    characters: characters.slice(0, MAX_ENTRIES_PER_SECTION),
    reviewRequired: characterSectionUnparsed || allEntries.length > entries.length,
    omittedEntryCount: Math.max(0, allEntries.length - entries.length),
  };
}

export function extractValueChanges(text) {
  return String(text ?? '').split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => {
      const arrow = /(?:→|->|⇒)/u.exec(raw);
      if (!arrow) return null;
      const beforeSide = raw.slice(0, arrow.index).trim();
      const after = raw.slice(arrow.index + arrow[0].length).trim();
      const colon = beforeSide.indexOf(':');
      const label = colon >= 0 ? beforeSide.slice(0, colon).trim() : beforeSide;
      const before = colon >= 0 ? beforeSide.slice(colon + 1).trim() : beforeSide;
      return { label, before, after, raw };
    })
    .filter(Boolean);
}

export function parseRiotListing(html, language = 'pt-br') {
  const root = parseHtml(String(html ?? ''));
  const cards = walk(root, (node) => node.tag === 'a'
    && (attribute(node, 'data-testid') ?? '').includes('articlefeaturedcard-component'));
  return cards.map((card) => {
    const url = normalizeRiotArticleUrl(attribute(card, 'href'), language);
    if (!url) return null;
    const title = walk(card, (node) => attribute(node, 'data-testid') === 'card-title')[0];
    const description = walk(card, (node) => attribute(node, 'data-testid') === 'card-description')[0];
    const time = walk(card, (node) => node.tag === 'time' && attribute(node, 'datetime'))[0];
    const image = walk(card, (node) => node.tag === 'img')
      .map((node) => validatedImageUrl(attribute(node, 'src')))
      .find(Boolean) ?? null;
    return {
      canonicalUrl: url,
      title: title ? nodeText(title) : nodeText(card),
      summary: description ? nodeText(description) : '',
      publishedAt: time ? attribute(time, 'datetime') : null,
      image,
      language,
    };
  }).filter(Boolean);
}

export function parseRiotArticle(html, sourceUrl) {
  const root = parseHtml(String(html ?? ''));
  const language = attribute(walk(root, (node) => node.tag === 'html')[0] ?? {}, 'lang') ?? 'unknown';
  const pageTitle = walk(root, (node) => node.tag === 'h1' && attribute(node, 'data-testid') === 'title')[0];
  const title = pageTitle ? nodeText(pageTitle) : (findMeta(root, 'property', 'og:title') ?? 'Artigo oficial sem título');
  const canonicalValue = walk(root, (node) => node.tag === 'link' && attribute(node, 'rel') === 'canonical')[0];
  const canonicalUrl = normalizeRiotArticleUrl(
    attribute(canonicalValue, 'href') ?? findMeta(root, 'property', 'og:url') ?? sourceUrl,
  );
  if (!canonicalUrl) throw new Error('RIOT_ARTICLE_CANONICAL_URL_INVALID');

  const time = walk(root, (node) => node.tag === 'time' && attribute(node, 'datetime'))[0];
  const publishedAt = time ? new Date(attribute(time, 'datetime')) : null;
  const safePublishedAt = publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : null;
  const tagline = walk(root, (node) => attribute(node, 'data-testid') === 'tagline')[0];
  const summary = tagline
    ? nodeText(tagline)
    : (findMeta(root, 'name', 'description') ?? findMeta(root, 'property', 'og:description') ?? '');
  const version = parseVersion(title, summary);
  const sectionNodes = walk(root, (node) => node.tag === 'section'
    && ['ArticleRichTextBlade', 'CharacterChanges'].includes(attribute(node, 'data-testid')));
  let remainingEntries = MAX_TOTAL_ARTICLE_ENTRIES;
  const sections = sectionNodes.slice(0, 100).map((node) => {
    const section = parseSection(node);
    const allowedEntries = section.entries.slice(0, remainingEntries);
    const omittedEntryCount = section.omittedEntryCount + (section.entries.length - allowedEntries.length);
    remainingEntries -= allowedEntries.length;
    return {
      ...section,
      entries: allowedEntries,
      characters: section.characters.slice(0, allowedEntries.length),
      reviewRequired: omittedEntryCount > 0,
      omittedEntryCount,
    };
  });
  const images = walk(root, (node) => node.tag === 'img')
    .map((node) => ({ url: validatedImageUrl(attribute(node, 'src')), alt: attribute(node, 'alt') ?? '' }))
    .filter((item) => item.url)
    .filter((item, index, array) => array.findIndex((other) => other.url === item.url) === index)
    .slice(0, 12);
  const heroImage = validatedImageUrl(findMeta(root, 'property', 'og:image')) ?? images[0]?.url ?? null;
  const contentHash = createHash('sha256').update(JSON.stringify({
    title,
    version,
    publishedAt: safePublishedAt?.toISOString() ?? null,
    summary,
    sections: sections.map(({ id, title: sectionTitleText, text: sectionText }) => ({ id, title: sectionTitleText, text: sectionText })),
    images: images.map((item) => item.url),
  })).digest('hex');

  return {
    canonicalUrl,
    sourceUrl,
    title,
    version,
    publishedAt: safePublishedAt,
    language,
    summary,
    heroImage,
    images,
    sections,
    contentHash,
    reviewRequired: sections.length === 0 || sections.some((section) => section.reviewRequired),
  };
}
