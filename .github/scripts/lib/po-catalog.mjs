/**
 * Conservative GNU gettext PO catalog matching and translation delta generation.
 *
 * Crowdin file-based project string IDs are project-local. Across projects, gettext
 * identity is the source tuple: context + msgid + msgid_plural. A delta contains
 * only upstream translations whose matching destination source entry is still empty.
 */
function decodePoQuotedString(quoted) {
  if (quoted.length < 2 || quoted[0] !== '"' || quoted.at(-1) !== '"') {
    throw new Error('Invalid PO string literal: ' + quoted);
  }

  const bytes = [];
  const appendText = value => bytes.push(...Buffer.from(value, 'utf8'));

  for (let index = 1; index < quoted.length - 1;) {
    const character = quoted[index];

    if (character !== '\\') {
      const codePoint = quoted.codePointAt(index);
      const value = String.fromCodePoint(codePoint);
      appendText(value);
      index += value.length;
      continue;
    }

    index += 1;
    if (index >= quoted.length - 1) throw new Error('Incomplete escape in PO string literal.');

    const escaped = quoted[index];
    const simpleEscapes = {
      '"': 0x22,
      "'": 0x27,
      '?': 0x3f,
      '\\': 0x5c,
      a: 0x07,
      b: 0x08,
      f: 0x0c,
      n: 0x0a,
      r: 0x0d,
      t: 0x09,
      v: 0x0b,
    };

    if (Object.hasOwn(simpleEscapes, escaped)) {
      bytes.push(simpleEscapes[escaped]);
      index += 1;
      continue;
    }

    if (/[0-7]/.test(escaped)) {
      const match = quoted.slice(index).match(/^[0-7]{1,3}/)[0];
      bytes.push(Number.parseInt(match, 8) & 0xff);
      index += match.length;
      continue;
    }

    if (escaped === 'x') {
      const match = quoted.slice(index + 1, -1).match(/^[\da-fA-F]+/);
      if (!match) throw new Error('Invalid hexadecimal escape in PO string literal.');
      bytes.push(Number.parseInt(match[0], 16) & 0xff);
      index += match[0].length + 1;
      continue;
    }

    if (escaped === 'u' || escaped === 'U') {
      const length = escaped === 'u' ? 4 : 8;
      const digits = quoted.slice(index + 1, index + 1 + length);
      if (digits.length !== length || !/^[\da-fA-F]+$/.test(digits)) {
        throw new Error('Invalid Unicode escape in PO string literal.');
      }
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        throw new Error('Invalid Unicode code point in PO string literal.');
      }
      appendText(String.fromCodePoint(codePoint));
      index += length + 1;
      continue;
    }

    // Retain producer-specific escapes instead of collapsing distinct source keys.
    bytes.push(0x5c);
    appendText(escaped);
    index += 1;
  }

  return Buffer.from(bytes).toString('utf8');
}

function sourceKey(entry) {
  return JSON.stringify([
    entry.context === undefined ? null : entry.context,
    entry.msgid,
    entry.msgidPlural === undefined ? null : entry.msgidPlural,
  ]);
}

function parsePoEntry(block, blockIndex) {
  const entry = {
    raw: block,
    context: undefined,
    msgid: undefined,
    msgidPlural: undefined,
    translations: new Map(),
    obsolete: false,
  };
  let activeField = null;
  let hasContent = false;

  const assign = (field, value, pluralIndex) => {
    if (field === 'msgctxt' || field === 'msgid' || field === 'msgid_plural') {
      const property = { msgctxt: 'context', msgid: 'msgid', msgid_plural: 'msgidPlural' }[field];
      if (entry[property] !== undefined) {
        throw new Error('Duplicate ' + field + ' directive in PO block ' + (blockIndex + 1) + '.');
      }
      entry[property] = value;
      activeField = { type: 'source', property };
    } else {
      const index = pluralIndex === undefined ? 0 : Number(pluralIndex);
      if (entry.translations.has(index)) {
        throw new Error('Duplicate msgstr[' + index + '] directive in PO block ' + (blockIndex + 1) + '.');
      }
      entry.translations.set(index, value);
      activeField = { type: 'translation', index };
    }
  };

  for (const originalLine of block.split(/\r?\n/)) {
    const line = originalLine.trimEnd();
    if (!line.trim()) continue;

    if (line.startsWith('#~')) {
      entry.obsolete = true;
      activeField = null;
      continue;
    }
    if (line.startsWith('#')) continue;

    const directive = line.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+("(?:\\.|[^"\\])*")\s*$/);
    if (directive) {
      hasContent = true;
      const field = directive[1].startsWith('msgstr') ? 'msgstr' : directive[1];
      assign(field, decodePoQuotedString(directive[3]), directive[2]);
      continue;
    }

    const continuation = line.match(/^\s*("(?:\\.|[^"\\])*")\s*$/);
    if (continuation && activeField) {
      hasContent = true;
      const value = decodePoQuotedString(continuation[1]);
      if (activeField.type === 'source') {
        entry[activeField.property] += value;
      } else {
        entry.translations.set(
          activeField.index,
          entry.translations.get(activeField.index) + value
        );
      }
      continue;
    }

    throw new Error('Unsupported PO syntax in block ' + (blockIndex + 1) + ': ' + line);
  }

  if (!hasContent) return null;
  if (entry.obsolete) return null;
  if (entry.msgid === undefined) {
    throw new Error('PO block ' + (blockIndex + 1) + ' has no msgid directive.');
  }

  entry.key = sourceKey(entry);
  entry.isHeader =
    entry.context === undefined &&
    entry.msgid === '' &&
    entry.msgidPlural === undefined;

  return entry;
}

function splitPoBlocks(po) {
  const blocks = [];
  let lines = [];
  let hasMsgid = false;
  let hasMsgstr = false;
  let hasObsolete = false;

  const flush = () => {
    if (lines.length) blocks.push(lines.join('\n'));
    lines = [];
    hasMsgid = false;
    hasMsgstr = false;
    hasObsolete = false;
  };

  for (const line of po.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }

    const directive = line.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s/);
    const startsNewEntry = Boolean(
      lines.length &&
      (
        (line.startsWith('#') && hasMsgstr) ||
        (
          directive &&
          (directive[1] === 'msgctxt' || directive[1] === 'msgid') &&
          ((hasMsgid && hasMsgstr) || hasObsolete)
        )
      )
    );

    if (startsNewEntry) flush();

    lines.push(line);
    if (/^#~/.test(line)) hasObsolete = true;
    if (directive?.[1] === 'msgid') hasMsgid = true;
    if (directive?.[1].startsWith('msgstr')) hasMsgstr = true;
  }

  flush();
  return blocks;
}

export function parsePoCatalog(po) {
  if (typeof po !== 'string' || !po.trim()) {
    throw new Error('PO catalog is empty or is not a string.');
  }

  const normalized = po.replace(/^\uFEFF/, '');
  const blocks = splitPoBlocks(normalized);
  const entries = [];
  const index = new Map();
  let header = null;

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const entry = parsePoEntry(blocks[blockIndex], blockIndex);
    if (!entry) continue;

    if (entry.isHeader) {
      if (header) throw new Error('PO catalog contains more than one header entry.');
      header = entry;
      continue;
    }

    if (index.has(entry.key)) {
      throw new Error('PO catalog contains duplicate source identity: ' + entry.key);
    }

    entries.push(entry);
    index.set(entry.key, entry);
  }

  return { entries, index, header };
}

function hasAnyTranslation(entry) {
  return [...entry.translations.values()].some(value => value.length > 0);
}

function hasMeaningfulTranslation(entry) {
  for (const [pluralIndex, translation] of entry.translations) {
    if (!translation) continue;

    const source = pluralIndex === 0
      ? entry.msgid
      : (entry.msgidPlural ?? entry.msgid);

    if (translation !== source) return true;
  }

  return false;
}

function getPluralFormCount(header) {
  const headerText = header?.translations?.get(0) || '';
  const match = String(headerText).match(/\bPlural-Forms:\s*nplurals\s*=\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function hasPartiallyTranslatedSourcePlural(entry, expectedFormCount) {
  if (entry.msgidPlural === undefined) return false;
  const inferredFormCount = entry.translations.size
    ? Math.max(...entry.translations.keys()) + 1
    : 0;
  const formCount = expectedFormCount || inferredFormCount;
  if (formCount < 2) return false;
  const forms = Array.from({ length: formCount }, (_, index) => entry.translations.get(index) || '');
  return forms.some(Boolean) && forms.some(value => value.length === 0);
}

function sourceTextForTranslation(entry, pluralIndex) {
  return pluralIndex === 0
    ? entry.msgid
    : (entry.msgidPlural ?? entry.msgid);
}

/**
 * Return expected translated forms that are not present verbatim in the
 * destination catalog. A non-empty destination value alone is not proof
 * that the expected upstream translation was imported.
 */
export function findMissingExpectedTranslationsPo(expectedPo, destinationPo) {
  const expected = parsePoCatalog(expectedPo);
  const destination = parsePoCatalog(destinationPo);
  const missing = [];

  for (const entry of expected.entries) {
    const destinationEntry = destination.index.get(entry.key);
    for (const [pluralIndex, expectedText] of entry.translations) {
      if (!expectedText || expectedText === sourceTextForTranslation(entry, pluralIndex)) continue;
      const actualText = destinationEntry?.translations.get(pluralIndex);
      if (actualText !== expectedText) {
        missing.push({
          key: entry.key,
          pluralIndex,
          expected: expectedText,
          actual: actualText,
        });
      }
    }
  }

  return missing;
}

function hasConflictingTranslation(sourceEntry, destinationEntry) {
  for (const [pluralIndex, sourceTranslation] of sourceEntry.translations) {
    if (!sourceTranslation || sourceTranslation === sourceTextForTranslation(sourceEntry, pluralIndex)) {
      continue;
    }
    const destinationTranslation = destinationEntry.translations.get(pluralIndex);
    if (destinationTranslation && destinationTranslation !== sourceTranslation) return true;
  }
  return false;
}

function hasPartiallyTranslatedPlural(sourceEntry, destinationEntry) {
  if (sourceEntry.msgidPlural === undefined) return false;

  const requiredForms = [...sourceEntry.translations]
    .filter(([, translation]) => translation.length > 0)
    .map(([pluralIndex]) => pluralIndex);
  if (requiredForms.length < 2) return false;

  const presentForms = new Set(
    [...destinationEntry.translations]
      .filter(([, translation]) => translation.length > 0)
      .map(([pluralIndex]) => pluralIndex)
  );

  const presentCount = requiredForms.filter(index => presentForms.has(index)).length;
  return presentCount > 0 && presentCount < requiredForms.length;
}

/**
 * Builds a valid PO delta from translated upstream entries that:
 *  - have an exact matching destination source identity;
 *  - do not already have a meaningful destination translation (a non-empty msgstr
 *    identical to its msgid is treated as untranslated).
 *
 * Existing destination translations (approved or not) are always preserved.
 * Unmatched source identities are reported but never imported as new strings.
 */
export function buildMissingTranslationsPo(sourcePo, destinationPo) {
  const source = parsePoCatalog(sourcePo);
  const destination = parsePoCatalog(destinationPo);
  const expectedPluralFormCount = getPluralFormCount(source.header);
  const deltaEntries = [];

  let sourceTranslated = 0;
  let sourceEqualsSource = 0;
  let matched = 0;
  let alreadyTranslated = 0;
  let partiallyTranslated = 0;
  let sourcePartiallyTranslated = 0;
  let conflictingEntries = 0;
  let unmatched = 0;

  for (const entry of source.entries) {
    if (!hasAnyTranslation(entry)) continue;
    if (hasPartiallyTranslatedSourcePlural(entry, expectedPluralFormCount)) {
      sourcePartiallyTranslated += 1;
      continue;
    }
    if (!hasMeaningfulTranslation(entry)) {
      sourceEqualsSource += 1;
      continue;
    }

    sourceTranslated += 1;
    const destinationEntry = destination.index.get(entry.key);

    if (!destinationEntry) {
      unmatched += 1;
      continue;
    }

    matched += 1;
    if (hasAnyTranslation(destinationEntry)) {
      if (hasPartiallyTranslatedPlural(entry, destinationEntry)) {
        partiallyTranslated += 1;
      } else {
        alreadyTranslated += 1;
        if (hasConflictingTranslation(entry, destinationEntry)) conflictingEntries += 1;
      }
      continue;
    }

    deltaEntries.push(entry);
  }

  const outputBlocks = [
    // The delta belongs to the destination project, so retain its Crowdin
    // metadata rather than leaking the upstream project/file identifiers.
    ...(destination.header ? [destination.header.raw] : source.header ? [source.header.raw] : []),
    ...deltaEntries.map(entry => entry.raw),
  ];
  const po = outputBlocks.length ? outputBlocks.join('\n\n').replace(/\s+$/, '') + '\n' : '';

  return {
    po,
    sourceTranslated,
    sourceEqualsSource,
    destinationEntries: destination.entries.length,
    matched,
    alreadyTranslated,
    partiallyTranslated,
    sourcePartiallyTranslated,
    conflictingEntries,
    unmatched,
    deltaEntries: deltaEntries.length,
  };
}
