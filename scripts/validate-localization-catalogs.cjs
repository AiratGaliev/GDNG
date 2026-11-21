'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const localesRoot = path.resolve(__dirname, '../newIDE/app/src/locales');
const metadataPath = path.join(localesRoot, 'LocalesMetadata.js');

const fail = message => {
  throw new Error(message);
};

const checkJavaScript = filePath => {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    fail('Missing or empty compiled catalog: ' + path.relative(process.cwd(), filePath));
  }

  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    fail(
      'Invalid JavaScript catalog: ' +
        path.relative(process.cwd(), filePath) +
        '\n' +
        (result.stderr || result.stdout || 'Node exited with status ' + result.status)
    );
  }
};

const validate = () => {
  if (!fs.existsSync(metadataPath) || fs.statSync(metadataPath).size === 0) {
    fail('LocalesMetadata.js is missing or empty.');
  }

  delete require.cache[require.resolve(metadataPath)];
  const metadata = require(metadataPath);
  if (!Array.isArray(metadata) || metadata.length === 0) {
    fail('LocalesMetadata.js must export a non-empty array.');
  }

  const seen = new Set();
  for (const entry of metadata) {
    if (
      !entry ||
      typeof entry.languageCode !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(entry.languageCode)
    ) {
      fail('Invalid locale metadata entry: ' + JSON.stringify(entry));
    }

    if (seen.has(entry.languageCode)) {
      fail('Duplicate locale metadata entry: ' + entry.languageCode);
    }
    seen.add(entry.languageCode);

    if (typeof entry.languageName !== 'string' || !entry.languageName) {
      fail('Missing languageName for ' + entry.languageCode);
    }
    if (
      typeof entry.languageNativeName !== 'string' ||
      !entry.languageNativeName
    ) {
      fail('Missing languageNativeName for ' + entry.languageCode);
    }
    if (
      !Number.isFinite(entry.translationRatio) ||
      entry.translationRatio < 0 ||
      entry.translationRatio > 1
    ) {
      fail('Invalid translationRatio for ' + entry.languageCode);
    }

    checkJavaScript(
      path.join(localesRoot, entry.languageCode, 'messages.js')
    );
  }

  if (!seen.has('en')) {
    fail('The compiled English catalog is not present in locale metadata.');
  }

  const extensionMetadataPath = path.join(
    localesRoot,
    'ExtensionLocalesMetadata.js'
  );
  if (fs.existsSync(extensionMetadataPath)) {
    checkJavaScript(extensionMetadataPath);
  }

  let extensionCatalogCount = 0;
  for (const directory of fs.readdirSync(localesRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;

    const extensionCatalogPath = path.join(
      localesRoot,
      directory.name,
      'extension-messages.js'
    );
    if (fs.existsSync(extensionCatalogPath)) {
      checkJavaScript(extensionCatalogPath);
      extensionCatalogCount += 1;
    }
  }

  console.log(
    'Validated ' +
      metadata.length +
      ' editor locale catalogs and ' +
      extensionCatalogCount +
      ' extension locale catalogs.'
  );
};

try {
  validate();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
