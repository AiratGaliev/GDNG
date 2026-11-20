const shell = require('shelljs');
const path = require('path');
const fs = require('fs');
const { getLocales, getLocalePath } = require('./lib/Locales');
const isWin = /^win/.test(process.platform);

const gdScriptsPath = path.join(__dirname, '../../../scripts');
const newIdeAppPath = path.join(__dirname, '..');

async function main() {
  // Clean existing English messages catalog, if any.
  const enMessagesJsPath = path.join(newIdeAppPath, 'src/locales/en/messages.js');
  if (fs.existsSync(enMessagesJsPath)) {
    shell.echo(
      `ℹ️ Removing ${enMessagesJsPath} as "en" should not have any translations ("pot" file)`
    );
    if (shell.rm(enMessagesJsPath).code !== 0) {
      throw new Error('Could not remove the previous English compiled catalog.');
    }
  }

  const enIdeMessagesPotPath = path.join(
    newIdeAppPath,
    'src/locales/en/ide-messages.pot'
  );
  if (fs.existsSync(enIdeMessagesPotPath)) {
    shell.echo(
      `ℹ️ Removing ${enIdeMessagesPotPath} as "en" should not have any translations ("pot" file)`
    );
    if (shell.rm(enIdeMessagesPotPath).code !== 0) {
      throw new Error('Could not remove the previous English source catalog.');
    }
  }

  shell.echo('ℹ️ Extracting translations for newIDE...');
  const linguiResult = shell.exec(
    'node node_modules/.bin/lingui extract --clean --overwrite',
    { cwd: newIdeAppPath }
  );
  if (linguiResult.code !== 0) {
    throw new Error('Lingui extraction failed: ' + linguiResult.stderr);
  }

  // Wait for locale discovery and every rename to finish before continuing.
  shell.echo('ℹ️ Renaming extracted translations to ide-messages.po...');
  const locales = await getLocales();
  for (const locale of locales) {
    const localePath = getLocalePath(locale);
    const sourcePath = path.join(localePath, 'messages.po');
    const destinationPath = path.join(
      localePath,
      locale === 'en' || locale === 'pseudo_LOCALE'
        ? 'ide-messages.pot'
        : 'ide-messages.po'
    );

    if (!fs.existsSync(sourcePath)) {
      throw new Error('Lingui did not create the expected catalog: ' + sourcePath);
    }
    const moveResult = shell.mv(sourcePath, destinationPath);
    if (moveResult.code !== 0 || !fs.existsSync(destinationPath)) {
      throw new Error('Could not move extracted catalog to ' + destinationPath);
    }
  }

  shell.echo(
    'ℹ️ Extracting translations for GDCore/GDJS/Extensions to scripts/gdcore-gdcpp-gdjs-extensions-messages.pot...'
  );
  const extractionResult = isWin
    ? shell.exec('ExtractTranslations.bat', { cwd: gdScriptsPath })
    : shell.exec('./ExtractTranslations.sh', { cwd: gdScriptsPath });
  if (extractionResult.code !== 0) {
    throw new Error(
      'GDCore/GDJS/Extensions extraction failed: ' + extractionResult.stderr
    );
  }

  shell.echo('✅ Translations extracted');
}

main().catch(error => {
  shell.echo('❌ Error(s) occurred while extracting translations: ' + error.stack);
  process.exitCode = 1;
});
