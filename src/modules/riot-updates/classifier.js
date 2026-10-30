import { extractValueChanges } from './parser.js';

export const PATCH_CATEGORIES = Object.freeze([
  'CHAMPION_BALANCE', 'ITEM_BALANCE', 'RUNE_BALANCE', 'SYSTEM_BALANCE',
]);

export const UPDATE_CATEGORIES = Object.freeze([
  'NEW_CHAMPION', 'SKIN_RELEASE', 'EVENT', 'GAME_MODE', 'BATTLE_PASS', 'MAJOR_ANNOUNCEMENT',
]);

const CATEGORY_PATTERNS = Object.freeze([
  ['CHAMPION_BALANCE', /(?:champion|champions|campe(?:ão|ões|a|as)|campeao|campeoes|character).{0,35}(?:balance|adjust|change|mudan|ajust|balanceamento)|(?:balance|mudan|ajust).{0,35}(?:champion|campe)/iu],
  ['ITEM_BALANCE', /\b(?:items?|itens?|equipment|equipamentos?)\b/iu],
  ['RUNE_BALANCE', /\b(?:runes?|runas?)\b/iu],
  ['GAME_MODE', /(?:game\s*modes?|modo(?:s)?\s+(?:de\s+jogo|personalizado|de\s+aventura)|aaa\s*aram|aram changes|howling abyss|abismo uivante)/iu],
  ['NEW_CHAMPION', /(?:new\s+champions?|nov[oa]s?\s+campe(?:ão|ões|a|as)|champion\s+(?:overview|spotlight)|vis[aã]o\s+geral\s+do\s+campe)/iu],
  ['SKIN_RELEASE', /(?:skins?|chromas?|vis(?:ual|uais)\s+updates?|visuais?\s+de\s+skins?)/iu],
  ['BATTLE_PASS', /(?:wild\s*pass|battle\s*pass|passe\s+(?:wild|selvagem|de\s+batalha)|mini\s*pass|mini\s*passe)/iu],
  ['EVENT', /\b(?:events?|eventos?|season|temporada|festival|celebration|celebra(?:ção|cao)|missions?|miss(?:ões|oes))\b/iu],
  ['SYSTEM_BALANCE', /(?:system(?:s)?|sistema(?:s)?|gameplay|in.game|mechanic|mecanica|jungle|selva|turret|torre|objective|objetivo|ranked|ranquead|other adjustments|outras altera(?:ções|coes)|outros conteudos do campo de batalha)/iu],
]);

const GENERIC_HEADINGS = new Set([
  'introduction', 'introdução', 'introduction and overview', 'overview', 'visão geral', 'visao geral',
  'summary', 'resumo', 'notes', 'notas', 'bug fixes', 'correções de bugs', 'correcoes de bugs',
  'novidades',
]);

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
}

function isChampionBalanceHeading(value) {
  const text = normalize(value);
  return /(?:champion|campe|character).{0,40}(?:balance|adjust|change|mudan|ajust)|(?:balance|mudan|ajust).{0,40}(?:champion|campe)/u.test(text);
}

export function categoriesForHeading(value) {
  const text = normalize(value);
  if (isChampionBalanceHeading(text)) return ['CHAMPION_BALANCE'];
  return CATEGORY_PATTERNS
    .filter(([category, pattern]) => category !== 'CHAMPION_BALANCE' && pattern.test(text))
    .map(([category]) => category);
}

function isMajorPatch(version) {
  return typeof version === 'string' && /^\d+\.\d+$/u.test(version);
}

function tuningLabel(text) {
  const normalized = normalize(text);
  const strengthening = /(?:buff|buffs|strengthen|strengthening|boost|increas|increased|increase|reforc|fortalec|aument)/u.test(normalized);
  const weakening = /(?:nerf|nerfs|weaken|weakening|reduc|reduced|decreas|dial(?:ing)? back|lower|diminu|enfraquec)/u.test(normalized);
  if (strengthening && !weakening) return 'fortalecimento';
  if (weakening && !strengthening) return 'enfraquecimento';
  return 'ajuste';
}

function isGenericHeading(value) {
  return GENERIC_HEADINGS.has(normalize(value).trim());
}

function displayName(entry, section) {
  return entry.name ?? entry.title ?? section.title ?? 'Alteração sem nome';
}

function updateCategories(category, text) {
  const categories = [category];
  if (
    UPDATE_CATEGORIES.includes(category)
    && category !== 'SKIN_RELEASE'
    && /\b(?:nov[oa]s?\s+skins?|new\s+skins?|skins?\s+(?:novas?|que\s+chegam|lançadas|disponíveis))\b/iu.test(text)
  ) categories.push('SKIN_RELEASE');
  return [...new Set(categories)];
}

function updateAvailability(category, text) {
  if (!UPDATE_CATEGORIES.includes(category)) return null;
  if (/(?:já\s+(?:está|estão)\s+disponível|já\s+chegou|chegou\s+ao\s+(?:jogo|wild\s*rift)|já\s+está\s+no\s+jogo|now\s+available|already\s+available|is\s+live\b|out\s+now)/iu.test(text)) {
    return 'DISPONÍVEL';
  }
  if (/(?:chegará|chega(?:rão)?\s+no\s+dia|disponível\s+a\s+partir|will\s+(?:arrive|launch)|arrives\s+on|available\s+starting)/iu.test(text)) {
    return 'LANÇAMENTO ANUNCIADO';
  }
  return 'ANUNCIADO';
}

function makeClassifiedItem(article, section, entry, category) {
  const text = String(entry.text ?? '').trim();
  const skills = (entry.skills ?? []).map((skill) => ({
    name: skill.name,
    description: skill.text,
    values: skill.values ?? extractValueChanges(skill.text),
  }));
  return {
    id: null,
    category,
    categories: updateCategories(category, text),
    name: displayName(entry, section),
    availability: updateAvailability(category, text),
    classification: PATCH_CATEGORIES.includes(category) ? tuningLabel(`${section.title}\n${text}`) : null,
    description: entry.entityType === 'champion' ? (entry.summary || '') : (text || section.text),
    sectionTitle: section.title,
    image: entry.image?.url ?? null,
    skills,
    values: entry.values ?? extractValueChanges(text),
    originalText: text || section.text,
    sourceArticle: article.canonicalUrl,
    version: article.version,
    publishedAt: article.publishedAt,
    language: article.language,
    reviewRequired: false,
  };
}

function groupCategoryForHeading(value) {
  const text = normalize(value).trim();
  if (/(?:new champion|novo campeao|nova campea|campeao novo)/u.test(text)) return 'NEW_CHAMPION';
  if (/(?:wild\s*pass|battle\s*pass|passe\s+(?:wild|selvagem|de batalha)|mini\s*passe)/u.test(text)) return 'BATTLE_PASS';
  if (/(?:eventos?|events?|season|temporada)/u.test(text)) return 'EVENT';
  if (/(?:skins?|chromas?)/u.test(text)) return 'SKIN_RELEASE';
  if (/(?:game\s*modes?|modos?\s+(?:de jogo|personalizado|de aventura)|aaa\s*aram|abismo uivante)/u.test(text)) return 'GAME_MODE';
  if (/(?:champion|campe).{0,50}(?:durability|durabilidade)|(?:durability|durabilidade).{0,50}(?:champion|campe)|lista detalhada dos ajustes na durabilidade/u.test(text)) return 'CHAMPION_BALANCE';
  if (/^(?:items?|itens?)$/u.test(text)) return 'ITEM_BALANCE';
  if (/^(?:runes?|runas?)$/u.test(text)) return 'RUNE_BALANCE';
  if (/(?:other battlefield content|outros conteudos do campo de batalha)/u.test(text)) return 'SYSTEM_BALANCE';
  if (/(?:game mode changes|mudancas em modos de jogo)/u.test(text)) return 'GAME_MODE';
  return null;
}

function hasDeeperChild(entries, index, level) {
  const next = entries[index + 1];
  return Boolean(next && (Number.isInteger(next.level) ? next.level : 6) > level);
}

function addReview(reviewRequiredSections, section, entry, reason) {
  reviewRequiredSections.push({
    title: entry?.title ?? section.title,
    originalText: entry?.text || section.text,
    reason,
  });
}

export function classifyRiotArticle(article) {
  const patchNotes = [];
  const updates = [];
  const reviewRequiredSections = [];
  const classifiedSections = [];

  for (const section of article.sections ?? []) {
    const reviewCountBeforeSection = reviewRequiredSections.length;
    if (section.omittedEntryCount > 0) {
      addReview(
        reviewRequiredSections,
        section,
        { title: section.title, text: section.text },
        `A seção excedeu o limite de análise; ${section.omittedEntryCount} subdivisões foram preservadas no texto original para revisão.`,
      );
    } else if (section.reviewRequired) {
      addReview(
        reviewRequiredSections,
        section,
        { title: section.title, text: section.text },
        'A estrutura oficial da seção não pôde ser interpretada com segurança; o texto original foi preservado.',
      );
    }
    const sectionHeading = `${section.title ?? ''} ${section.id ?? ''}`;
    const sectionCategories = categoriesForHeading(sectionHeading);
    const entries = (section.entries ?? []).filter((entry) => String(entry.text ?? '').trim() || entry.name || entry.title);

    if (isGenericHeading(section.title) && !sectionCategories.length) {
      classifiedSections.push({ title: section.title, categories: [], reviewRequired: false });
      continue;
    }

    const splitItems = [];
    let inheritedGroup = null;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const level = Number.isInteger(entry.level) ? entry.level : 6;
      if (inheritedGroup && level <= inheritedGroup.level) inheritedGroup = null;

      if (isGenericHeading(entry.title)) continue;

      const titleCategories = categoriesForHeading(entry.title ?? entry.name ?? '');
      const explicitGroupCategory = groupCategoryForHeading(entry.title);
      const childGroupCategory = explicitGroupCategory
        ?? (titleCategories.length === 1 ? titleCategories[0] : null);
      const groupCategory = hasDeeperChild(entries, entryIndex, level) ? childGroupCategory : null;
      if (groupCategory) {
        if (entry.text.trim()) {
          const item = makeClassifiedItem(article, section, entry, groupCategory);
          splitItems.push(item);
          if (PATCH_CATEGORIES.includes(groupCategory)) patchNotes.push(item);
          else updates.push(item);
        }
        inheritedGroup = { category: groupCategory, level };
        continue;
      }

      const contentCategories = categoriesForHeading(entry.text ?? '');
      let categories = titleCategories.length === 1 ? titleCategories : [];
      if (!categories.length && inheritedGroup && level > inheritedGroup.level) {
        categories = [inheritedGroup.category];
      }
      if (!categories.length && sectionCategories.length === 1) categories = sectionCategories;
      if (!categories.length) categories = contentCategories;

      if (!entry.title && !entry.name && entry.entityType !== 'champion') {
        addReview(reviewRequiredSections, section, entry, 'Conteúdo introdutório sem elemento nomeado; preservado para revisão.');
        continue;
      }
      if (categories.length !== 1) {
        addReview(
          reviewRequiredSections,
          section,
          entry,
          categories.length > 1
            ? 'A subdivisão corresponde a mais de uma categoria.'
            : 'A subdivisão não corresponde a uma categoria conhecida.',
        );
        continue;
      }
      const item = makeClassifiedItem(article, section, entry, categories[0]);
      splitItems.push(item);
      if (PATCH_CATEGORIES.includes(item.category)) patchNotes.push(item);
      else updates.push(item);
    }

    if (splitItems.length) {
      classifiedSections.push({
        title: section.title,
        categories: [...new Set(splitItems.map((item) => item.category))],
        reviewRequired: reviewRequiredSections.length > reviewCountBeforeSection,
      });
    } else if (!isGenericHeading(section.title)) {
      addReview(reviewRequiredSections, section, null, 'Não foi possível classificar a seção com segurança.');
      classifiedSections.push({ title: section.title, categories: [], reviewRequired: true });
    }
  }

  const mergedPatchNotes = mergeItems(patchNotes);
  const mergedUpdates = mergeItems(updates);

  if (isMajorPatch(article.version)) {
    const description = article.summary;
    mergedUpdates.unshift({
      id: null,
      category: 'MAJOR_ANNOUNCEMENT',
      categories: ['MAJOR_ANNOUNCEMENT'],
      name: article.title,
      availability: updateAvailability('MAJOR_ANNOUNCEMENT', description),
      classification: null,
      description,
      sectionTitle: 'Atualização principal',
      image: article.heroImage,
      skills: [],
      values: [],
      originalText: description,
      sourceArticle: article.canonicalUrl,
      version: article.version,
      publishedAt: article.publishedAt,
      language: article.language,
      reviewRequired: false,
    });
  }

  for (const item of [...mergedPatchNotes, ...mergedUpdates]) {
    item.id = `${article.canonicalUrl}#${item.category}#${normalize(item.name).replace(/[^a-z0-9]+/gu, '-').slice(0, 50)}`;
  }

  return {
    articleUrl: article.canonicalUrl,
    patchNotes: mergedPatchNotes,
    updates: mergedUpdates,
    classifiedSections,
    reviewRequiredSections,
    reviewRequired: reviewRequiredSections.length > 0 || Boolean(article.reviewRequired),
  };
}

function mergeItems(items) {
  const merged = new Map();
  for (const item of items) {
    const key = `${item.category}\n${normalize(item.name).trim()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...item,
        skills: [...(item.skills ?? [])],
        values: [...(item.values ?? [])],
      });
      continue;
    }
    const descriptions = new Set([existing.description, item.description].filter(Boolean));
    existing.description = [...descriptions].join('\n\n');
    existing.originalText = [...new Set([existing.originalText, item.originalText].filter(Boolean))].join('\n\n');
    existing.skills = [...new Map(
      [...existing.skills, ...(item.skills ?? [])]
        .map((skill) => [`${normalize(skill.name)}\n${skill.description}`, skill]),
    ).values()];
    existing.values = [...new Map(
      [...existing.values, ...(item.values ?? [])].map((value) => [value.raw, value]),
    ).values()];
    if (existing.classification !== item.classification) existing.classification = 'ajuste';
    existing.image ??= item.image;
  }
  return [...merged.values()];
}
