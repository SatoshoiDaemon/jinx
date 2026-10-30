function getPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function setPath(value, path, nextValue) {
  const parts = path.split('.');
  let target = value;
  for (const part of parts.slice(0, -1)) target = target[part] ??= {};
  target[parts.at(-1)] = structuredClone(nextValue);
}

function deletePath(value, path) {
  const parts = path.split('.');
  const target = parts.slice(0, -1).reduce((current, key) => current?.[key], value);
  if (target) delete target[parts.at(-1)];
}

function valueMatches(actual, expected) {
  if (!expected || typeof expected !== 'object' || expected instanceof Date || Array.isArray(expected)) {
    return actual instanceof Date && expected instanceof Date
      ? actual.getTime() === expected.getTime()
      : actual === expected;
  }
  return Object.entries(expected).every(([operator, value]) => {
    if (operator === '$exists') return Boolean(value) === (actual !== undefined);
    if (operator === '$ne') return actual !== value;
    if (operator === '$in') return value.includes(actual);
    if (operator === '$lte') return actual != null && actual <= value;
    if (operator === '$lt') return actual != null && actual < value;
    if (operator === '$gte') return actual != null && actual >= value;
    if (operator === '$gt') return actual != null && actual > value;
    return false;
  });
}

function matches(document, filter) {
  return Object.entries(filter ?? {}).every(([key, expected]) => {
    if (key === '$or') return expected.some((clause) => matches(document, clause));
    return valueMatches(getPath(document, key), expected);
  });
}

function applyUpdate(document, update, inserting = false) {
  if (inserting) {
    for (const [path, value] of Object.entries(update.$setOnInsert ?? {})) setPath(document, path, value);
  }
  for (const [path, value] of Object.entries(update.$set ?? {})) setPath(document, path, value);
  for (const [path, value] of Object.entries(update.$inc ?? {})) {
    setPath(document, path, (getPath(document, path) ?? 0) + value);
  }
  for (const path of Object.keys(update.$unset ?? {})) deletePath(document, path);
}

function filterSeed(filter) {
  const seed = {};
  for (const [path, value] of Object.entries(filter ?? {})) {
    if (!path.startsWith('$') && (!value || typeof value !== 'object' || value instanceof Date)) {
      setPath(seed, path, value);
    }
  }
  return seed;
}

class MemoryCursor {
  constructor(documents, options = {}) {
    this.documents = documents;
    this.options = options;
  }

  sort(order) {
    this.order = order;
    return this;
  }

  async toArray() {
    const order = this.order ?? this.options.sort ?? {};
    const values = [...this.documents];
    values.sort((left, right) => {
      for (const [path, direction] of Object.entries(order)) {
        const a = getPath(left, path);
        const b = getPath(right, path);
        if (a === b) continue;
        if (a == null) return -1 * direction;
        if (b == null) return 1 * direction;
        return (a < b ? -1 : 1) * direction;
      }
      return 0;
    });
    return values.slice(0, this.options.limit ?? values.length).map((document) => structuredClone(document));
  }
}

class MemoryCollection {
  constructor(name) {
    this.name = name;
    this.documents = [];
  }

  async createIndex() {
    return 'memory-index';
  }

  async findOne(filter = {}, options = {}) {
    const found = this.documents.filter((document) => matches(document, filter));
    if (options.sort) {
      const sorted = await new MemoryCursor(found).sort(options.sort).toArray();
      return sorted[0] ?? null;
    }
    return found[0] ? structuredClone(found[0]) : null;
  }

  find(filter = {}, options = {}) {
    return new MemoryCursor(this.documents.filter((document) => matches(document, filter)), options);
  }

  async insertOne(document) {
    const duplicate = this.documents.some((existing) => {
      if (this.name === 'riot_publication_items') {
        return existing.pipeline === document.pipeline && existing.itemKey === document.itemKey;
      }
      if (this.name === 'riot_articles') return existing.canonicalUrl === document.canonicalUrl;
      return existing._id && document._id && existing._id === document._id;
    });
    if (duplicate) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    this.documents.push(structuredClone(document));
    return { acknowledged: true, insertedId: document._id };
  }

  async updateOne(filter, update, options = {}) {
    let document = this.documents.find((candidate) => matches(candidate, filter));
    const inserting = !document && options.upsert;
    if (!document && !inserting) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    if (inserting) {
      document = filterSeed(filter);
      this.documents.push(document);
    }
    applyUpdate(document, update, inserting);
    return { acknowledged: true, matchedCount: inserting ? 0 : 1, modifiedCount: 1, upsertedCount: inserting ? 1 : 0 };
  }

  async updateMany(filter, update) {
    const documents = this.documents.filter((document) => matches(document, filter));
    for (const document of documents) applyUpdate(document, update);
    return { acknowledged: true, matchedCount: documents.length, modifiedCount: documents.length };
  }
}

export class MemoryDatabase {
  constructor() {
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new MemoryCollection(name));
    return this.collections.get(name);
  }
}
