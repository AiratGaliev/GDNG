const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const policy = read('newIDE/app/src/Utils/LocalFeaturePolicy.js');
if (!/enabled:\s*true/.test(policy)) {
  throw new Error('GDNG local feature policy must remain enabled.');
}

if (!read('newIDE/app/.npmrc').split(/\r?\n/).includes('allow-git=root')) {
  throw new Error('The IDE must opt in only to direct Git dependencies.');
}

const electronPackage = JSON.parse(read('newIDE/electron-app/package.json'));
const electronInstallScript = `electron@${electronPackage.devDependencies.electron}`;
if (electronPackage.allowScripts?.[electronInstallScript] !== true) {
  throw new Error(
    `The Electron postinstall script must be explicitly allowed: ${electronInstallScript}`
  );
}

const electronAppPackage = JSON.parse(
  read('newIDE/electron-app/app/package.json')
);
const electronBuilder = read('newIDE/electron-app/electron-builder-config.js');
const electronMain = read('newIDE/electron-app/app/main.js');
if (
  electronPackage.productName !== 'GDNG' ||
  electronAppPackage.productName !== 'GDNG' ||
  !electronBuilder.includes("appId: 'com.gdng.editor'") ||
  !electronBuilder.includes("executableName: 'GDNG'") ||
  !electronBuilder.includes(
    "electronDist: path.join(__dirname, 'node_modules', 'electron', 'dist')"
  ) ||
  !electronBuilder.includes("owner: 'AiratGaliev'") ||
  !electronBuilder.includes("repo: 'GDNG'") ||
  !electronMain.includes("app.setAppUserModelId('com.gdng.editor')") ||
  electronMain.includes("app.setAppUserModelId('gdevelop.ide')") ||
  !electronMain.includes('const isGdngPortableBuild =') ||
  !electronMain.includes('reportPortableUpdateUnavailable') ||
  !electronBuilder.includes("to: 'gdng-portable-mode.flag'") ||
  !fs.existsSync(path.join(root, 'newIDE/electron-app/build/gdng-portable-mode.flag'))
) {
  throw new Error(
    'Desktop packaging, Windows identity and updater must target GDNG only.'
  );
}

const gdjsPackage = JSON.parse(read('GDJS/package.json'));
const esbuildAllowlist = Object.entries(gdjsPackage.allowScripts || {}).filter(
  ([name, allowed]) => name.startsWith('esbuild@') && allowed === true
);
if (esbuildAllowlist.length !== 1) {
  throw new Error('GDJS must explicitly allow exactly one pinned esbuild postinstall script.');
}

const checker = read(
  'newIDE/app/src/Profile/Subscription/SubscriptionChecker.js'
);
if (
  !checker.includes("from '../../Utils/LocalFeaturePolicy'") ||
  !checker.includes('canUseLocalFeature(authenticatedUser.subscription)')
) {
  throw new Error('SubscriptionChecker is not using the GDNG local feature policy.');
}

const loadingScreen = read(
  'newIDE/app/src/ProjectManager/LoadingScreenEditor.js'
);
if (
  !loadingScreen.includes("from '../Utils/LocalFeaturePolicy'") ||
  !/canUseLocalFeature\(\s*authenticatedUser\.subscription\s*\)/.test(
    loadingScreen
  )
) {
  throw new Error('LoadingScreenEditor is not using the GDNG local feature policy.');
}

for (const relativePath of [
  'newIDE/app/src/ExportAndShare/LocalExporters/LocalPreviewLauncher/index.js',
  'newIDE/app/src/MainFrame/EditorContainers/DebuggerEditorContainer.js',
]) {
  const source = read(relativePath);
  if (source.includes('checkUserHasSubscription()')) {
    throw new Error(
      `${relativePath} still invokes the old subscription checker API.`
    );
  }
  if (!source.includes('checkLocalFeatureAccess()')) {
    throw new Error(
      `${relativePath} is not using the GDNG local feature access API.`
    );
  }
}

console.log('GDNG local feature policy verification passed.');
