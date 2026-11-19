'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const circleci = read('.circleci/config.yml');
const releaseWorkflow = read('.github/workflows/release-multiplatform.yml');

function extractTopLevelSection(source, name) {
  const startPattern = new RegExp('^' + name + ':\\s*$', 'm');
  const startMatch = startPattern.exec(source);
  assert.ok(startMatch, 'Missing top-level section: ' + name);

  const contentStart = startMatch.index + startMatch[0].length;
  const remainder = source.slice(contentStart);
  const nextSection = /^\S[^\r\n]*:\s*$/m.exec(remainder);
  return nextSection ? remainder.slice(0, nextSection.index) : remainder;
}

function extractIndentedSection(source, name, indentation = 2) {
  const spaces = ' '.repeat(indentation);
  const startPattern = new RegExp('^' + spaces + name + ':\\s*$', 'm');
  const startMatch = startPattern.exec(source);
  assert.ok(startMatch, 'Missing section: ' + name);

  const contentStart = startMatch.index + startMatch[0].length;
  const remainder = source.slice(contentStart);
  const nextSection = new RegExp('^' + spaces + '[A-Za-z0-9_-]+:\\s*$', 'm').exec(
    remainder
  );
  return nextSection ? remainder.slice(0, nextSection.index) : remainder;
}

const circleJobs = extractTopLevelSection(circleci, 'jobs');
const circleWorkflows = extractTopLevelSection(circleci, 'workflows');

for (const jobName of [
  'verify-gdng-ci',
  'build-macos',
  'build-app-for-desktop',
  'build-linux',
  'build-gdevelop_js-wasm-only',
  'build-gdevelop_js-debug-sanitizers-and-extra-checks',
  'build-gdcore-tests-sanitizers',
  'build-windows',
  'run-cli-html5-export-linux',
  'build-storybook-for-visual-tests',
  'run-visual-monkey-tests-storybook-linux',
  'run-visual-monkey-tests-editor-linux',
]) {
  extractIndentedSection(circleJobs, jobName, 2);
}

const circleCommands = extractTopLevelSection(circleci, 'commands');
assert.match(circleCommands, /^  write-dependencies-checksum:/m);
assert.match(circleCommands, /^  install-emscripten-sdk:/m);
assert.match(circleCommands, /^  save-emscripten-sdk:/m);

const checksumCommand = extractIndentedSection(
  circleCommands,
  'write-dependencies-checksum',
  2
);
assert.match(
  checksumCommand,
  /command:\s*\|[\s\S]*?for lock_file in << parameters\.lock-files >>; do[\s\S]*?sha256sum "\$lock_file"[\s\S]*?done \| sha256sum \| cut -d ' ' -f1 > ci-dependencies-checksum\.txt/,
  'CircleCI lockfile checksum command must iterate over the parameterized files and produce a stable digest.'
);
assert.doesNotMatch(
  checksumCommand,
  /cat\s+<</,
  'Do not use an incomplete heredoc/redirection for the CircleCI lockfile checksum.'
);


const wasmBuild = extractIndentedSection(
  circleJobs,
  'build-gdevelop_js-wasm-only',
  2
);
assert.match(
  wasmBuild,
  /install-emscripten-sdk:[\s\S]*?cache-key: emsdk-3\.1\.21-linux-v1/,
  'The normal WASM job must use the reusable, cached Emscripten installer.'
);
assert.match(
  wasmBuild,
  /persist_to_workspace:[\s\S]*?paths:[\s\S]*?- Binaries\/embuild\/GDevelop\.js/,
  'CircleCI branch validation must persist its exact-commit WebAssembly output.'
);

const buildApp = extractIndentedSection(circleJobs, 'build-app-for-desktop', 2);
assert.match(buildApp, /attach_workspace:[\s\S]*?at: \./);
assert.match(buildApp, /REQUIRES_EXACT_LIBGD_JS_VERSION=true/);
assert.match(buildApp, /npm run build/);
assert.match(
  buildApp,
  /persist_to_workspace:[\s\S]*?- newIDE\/app\/build[\s\S]*?- newIDE\/app\/public\/libGD\.wasm/,
  'The shared editor build must persist its build, GDJS resources and exact Core/WASM files.'
);

for (const jobName of ['build-linux', 'build-windows']) {
  const job = extractIndentedSection(circleJobs, jobName, 2);
  assert.match(job, /attach_workspace:[\s\S]*?at: \./);
  assert.match(
    job,
    /node scripts\/app-build\.js --skip-app-build/,
    jobName + ' must package the shared upstream-style editor build.'
  );
  assert.match(
    job,
    /node scripts\/build\.js --skip-app-build/,
    jobName + ' must not rebuild the editor during platform packaging.'
  );
}

const circleBuilds = extractIndentedSection(circleWorkflows, 'builds', 2);
assert.ok(circleBuilds.includes('      - build-gdevelop_js-wasm-only'));
assert.ok(
  circleBuilds.includes(
    '      - build-app-for-desktop:\n          requires:\n            - build-gdevelop_js-wasm-only'
  ),
  'The main CircleCI editor build must consume the current-commit WASM workspace.'
);
for (const jobName of ['build-linux', 'build-windows']) {
  assert.ok(
    circleBuilds.includes(
      '      - ' + jobName + ':\n          requires:\n            - build-app-for-desktop'
    ),
    'The main CircleCI ' + jobName + ' package must consume the shared editor build.'
  );
}

const dailyWorkflow = extractIndentedSection(
  circleWorkflows,
  'daily-end-to-end-tests',
  2
);
assert.ok(dailyWorkflow.includes('      - build-gdevelop_js-wasm-only'));
assert.ok(
  dailyWorkflow.includes(
    '      - build-app-for-desktop:\n          requires:\n            - build-gdevelop_js-wasm-only'
  ),
  'The daily E2E workflow must build the shared editor from current-commit WASM.'
);
assert.ok(
  dailyWorkflow.includes(
    '      - build-linux:\n          requires:\n            - build-app-for-desktop'
  ),
  'The daily Linux E2E package must consume the shared editor build.'
);

assert.match(circleci, /origin\/custom/);
assert.match(circleci, /- custom/);
assert.doesNotMatch(circleci, /aws-cli\/setup|aws s3 sync/i);
assert.doesNotMatch(
  circleJobs,
  /^  publish-gdng-release:/m,
  'CircleCI must not run a competing release publisher.'
);
assert.doesNotMatch(
  circleWorkflows,
  /^  gdng-release:/m,
  'GitHub Actions must be the only GDNG tag-release workflow.'
);

const circleVerifyJob = extractIndentedSection(circleJobs, 'verify-gdng-ci', 2);
assert.match(circleVerifyJob, /node scripts\/verify-gdng-ci\.cjs/);
assert.match(circleVerifyJob, /node scripts\/verify-gdng-local-policy\.cjs/);

const requiredCircleWorkflows = [
  'ci-validation',
  'gdevelop_js-wasm-extra-checks',
  'tests',
  'builds',
  'daily-end-to-end-tests',
  'all-visual-tests',
  'changed-visual-tests',
];
for (const workflowName of requiredCircleWorkflows) {
  assert.ok(
    new RegExp('^  ' + workflowName + ':\\s*$', 'm').test(circleWorkflows),
    'Missing CircleCI workflow: ' + workflowName
  );
}

// GitHub Actions is the authoritative release pipeline. Every platform package
// consumes the same GDevelop.js artifact, and the publisher is gated by all
// native, WebAssembly, IDE, CLI and visual checks.
const ghaTriggers = extractTopLevelSection(releaseWorkflow, 'on');
assert.match(ghaTriggers, /push:[\s\S]*?branches:[\s\S]*?ci\/full-multiplatform-builds/);
assert.match(ghaTriggers, /tags:[\s\S]*?gdng-v\*/);
assert.match(ghaTriggers, /pull_request:[\s\S]*?types:[\s\S]*?closed[\s\S]*?branches:[\s\S]*?custom/);
assert.match(ghaTriggers, /workflow_dispatch:/);

const ghaJobs = extractTopLevelSection(releaseWorkflow, 'jobs');
assert.ok(
  ghaJobs.includes('name: Validate the upstream-derived CircleCI configuration') &&
    ghaJobs.includes('run: circleci config validate .circleci/config.yml'),
  'GitHub Actions must validate the upstream-derived CircleCI configuration.'
);
assert.ok(
  releaseWorkflow.includes(
    "cancel-in-progress: ${{ github.event_name == 'push' && github.ref_type == 'branch' }}"
  ),
  'A newer branch-validation push must supersede older runs without cancelling tag/manual runs.'
);
const requiredGhaJobs = [
  'release-gate',
  'verify',
  'build-wasm',
  'build-editor',
  'core-sanitizers',
  'wasm-debug-sanitizers',
  'build-linux',
  'build-macos',
  'build-windows',
  'cli-html5-export',
  'build-storybook',
  'visual-storybook',
  'visual-editor',
  'publish-release',
  'validate-dispatch',
];
for (const jobName of requiredGhaJobs) {
  extractIndentedSection(ghaJobs, jobName, 2);
}

const gateJob = extractIndentedSection(ghaJobs, 'release-gate', 2);
assert.ok(gateJob.includes('steps.route.outputs.should_build'));
assert.ok(gateJob.includes('github.event.pull_request.head.ref'));
assert.ok(gateJob.includes('github.event.pull_request.head.repo.full_name'));
assert.match(
  gateJob,
  /PR_HEAD_REPO.*GITHUB_REPOSITORY/,
  'Upstream release gate must accept only PR branches from this repository, never forks.'
);
assert.match(gateJob, /automation\/upstream-/);

const wasmJob = extractIndentedSection(ghaJobs, 'build-wasm', 2);
assert.match(wasmJob, /needs: \[release-gate\]/);
assert.match(wasmJob, /if: needs\.release-gate\.outputs\.should_build == 'true'/);
assert.match(wasmJob, /actions\/cache@v6[\s\S]*?key: gdng-emsdk-3\.1\.21-/);
assert.match(wasmJob, /steps\.emsdk-cache\.outputs\.cache-hit/);
assert.match(wasmJob, /emsdk install 3\.1\.21/);
assert.match(wasmJob, /actions\/cache@v6[\s\S]*?path: \.ccache/);
assert.match(wasmJob, /CCACHE_DIR:/);
assert.match(wasmJob, /CMAKE_C_COMPILER_LAUNCHER=ccache/);
assert.match(wasmJob, /ccache --show-stats/);
assert.match(wasmJob, /cache: npm/);
assert.match(wasmJob, /npm run build/);
assert.match(wasmJob, /npm test -- --runInBand/);
assert.match(wasmJob, /actions\/upload-artifact@/);
assert.match(wasmJob, /name: gdng-exact-commit-wasm/);

const verifyJob = extractIndentedSection(ghaJobs, 'verify', 2);
assert.match(verifyJob, /needs: \[build-wasm\]/);
assert.match(verifyJob, /actions\/download-artifact@/);
assert.match(verifyJob, /node scripts\/verify-gdng-ci\.cjs/);
assert.match(verifyJob, /react-app-rewired test/);
assert.match(verifyJob, /flow status/);
assert.match(verifyJob, /npm run check-types/);
assert.ok(
  verifyJob.indexOf('working-directory: GDevelop.js') >= 0 &&
    verifyJob.indexOf('working-directory: GDevelop.js') <
      verifyJob.indexOf('working-directory: newIDE/app'),
  'Verification must install GDevelop.js tooling before newIDE/app postinstall imports the local Core bindings.'
);

const idePackageLock = JSON.parse(read('newIDE/app/package-lock.json'));
assert.equal(
  idePackageLock.packages['node_modules/caniuse-lite']?.version,
  '1.0.30001826',
  'The IDE lockfile must pin refreshed caniuse-lite data so Browserslist does not emit stale-data warnings.'
);

const editorBuildJob = extractIndentedSection(ghaJobs, 'build-editor', 2);
assert.match(editorBuildJob, /needs: \[build-wasm\]/);
assert.match(editorBuildJob, /name: gdng-exact-commit-wasm/);
assert.match(editorBuildJob, /cache: npm/);
assert.match(editorBuildJob, /working-directory: GDevelop\.js[\s\S]*?npm install --no-audit --no-fund/);
assert.match(editorBuildJob, /working-directory: newIDE\/app[\s\S]*?npm install --no-audit --no-fund/);
assert.ok(editorBuildJob.indexOf('working-directory: GDevelop.js') < editorBuildJob.indexOf('working-directory: newIDE/app'));
assert.match(editorBuildJob, /react-app-rewired build/);
assert.match(editorBuildJob, /node scripts\/check-build-output\.js/);
assert.match(editorBuildJob, /newIDE\/app\/resources\/GDJS/);
assert.match(editorBuildJob, /newIDE\/app\/public\/libGD\.wasm/);
assert.match(editorBuildJob, /name: gdng-shared-editor/);

const linuxJob = extractIndentedSection(ghaJobs, 'build-linux', 2);
assert.match(linuxJob, /needs: \[build-editor\]/);
assert.match(linuxJob, /name: gdng-shared-editor[\s\S]*?path: newIDE\/app/);
assert.match(linuxJob, /node scripts\/app-build\.js --skip-app-build/);
assert.match(linuxJob, /node scripts\/build\.js --skip-app-build --linux --publish=never/);
assert.match(linuxJob, /cache: npm/);

const windowsJob = extractIndentedSection(ghaJobs, 'build-windows', 2);
assert.match(windowsJob, /needs: \[build-editor\]/);
assert.match(windowsJob, /name: gdng-shared-editor[\s\S]*?path: newIDE\/app/);
assert.match(windowsJob, /node scripts\/app-build\.js --skip-app-build/);
assert.match(windowsJob, /node scripts\/build\.js --skip-app-build --win nsis --publish=never/);
assert.match(windowsJob, /node scripts\/build\.js --skip-app-build --win zip --publish=never/);
assert.match(windowsJob, /cache: npm/);
assert.doesNotMatch(windowsJob, /Push-Location GDevelop\.js/);
assert.doesNotMatch(windowsJob, /Push-Location newIDE\/app/);

const macosJob = extractIndentedSection(ghaJobs, 'build-macos', 2);
assert.match(macosJob, /needs: \[build-editor\]/);
assert.match(macosJob, /name: gdng-shared-editor[\s\S]*?path: newIDE\/app/);
assert.match(macosJob, /node scripts\/app-build\.js --skip-app-build/);
assert.match(macosJob, /npm run build -- --skip-app-build --mac/);
assert.doesNotMatch(macosJob, /cd GDevelop\.js|cd newIDE\/app/);
assert.match(macosJob, /cache: npm/);
assert.match(macosJob, /runs-on: macos-15-intel/);
assert.doesNotMatch(macosJob, /runs-on: macos-14/);
assert.doesNotMatch(
  macosJob,
  /python3 -m pip install/,
  'macOS hosted runners use externally managed Homebrew Python; do not install setuptools with system pip.'
);
assert.match(releaseWorkflow, /^permissions:\s*\n  contents: read/m);
assert.match(windowsJob, /needs: \[build-editor\]/);
assert.match(windowsJob, /--skip-app-build --win nsis --publish=never/);
assert.match(windowsJob, /--skip-app-build --win zip --publish=never/);
assert.match(windowsJob, /name: gdng-release-windows/);

for (const [jobName, requiredArg] of [
  ['build-linux', '--linux'],
  ['build-macos', '--mac'],
  ['build-windows', '--win nsis'],
]) {
  const job = extractIndentedSection(ghaJobs, jobName, 2);
  assert.ok(job.includes(requiredArg), jobName + ' is missing its platform build target.');
}

const coreSanitizersJob = extractIndentedSection(ghaJobs, 'core-sanitizers', 2);
assert.match(coreSanitizersJob, /actions\/cache@v6[\s\S]*?path: \.ccache/);
assert.match(coreSanitizersJob, /CCACHE_DIR:/);
assert.match(coreSanitizersJob, /ccache --show-stats/);

const debugSanitizersJob = extractIndentedSection(ghaJobs, 'wasm-debug-sanitizers', 2);
assert.match(debugSanitizersJob, /needs: \[release-gate\]/);
assert.match(debugSanitizersJob, /if: needs\.release-gate\.outputs\.should_build == 'true'/);
assert.match(debugSanitizersJob, /actions\/cache@v6[\s\S]*?path: \.ccache/);
assert.match(debugSanitizersJob, /actions\/cache@v6[\s\S]*?key: gdng-emsdk-3\.1\.21-/);
assert.match(debugSanitizersJob, /CMAKE_C_COMPILER_LAUNCHER=ccache/);
assert.match(debugSanitizersJob, /ccache --show-stats/);

const cliJob = extractIndentedSection(ghaJobs, 'cli-html5-export', 2);
assert.match(cliJob, /needs: \[build-linux\]/);
assert.match(cliJob, /--zipPath=/);
assert.match(cliJob, /xvfb-run/);
assert.match(
  cliJob,
  /https-proxy-agent@\^5\.0\.1/,
  'CLI smoke-test scratch dependencies must include https-proxy-agent, required at module load by DownloadLocalFile.'
);

const storybookJob = extractIndentedSection(ghaJobs, 'build-storybook', 2);
assert.match(storybookJob, /name: gdng-exact-commit-wasm/);
assert.match(storybookJob, /npm run build-storybook/);
assert.ok(
  storybookJob.indexOf('working-directory: GDevelop.js') >= 0 &&
    storybookJob.indexOf('working-directory: GDevelop.js') <
      storybookJob.indexOf('working-directory: newIDE/app'),
  'Storybook must install GDevelop.js tooling before newIDE/app postinstall.'
);

const storybookVisualJob = extractIndentedSection(
  ghaJobs,
  'visual-storybook',
  2
);
assert.match(storybookVisualJob, /needs: \[build-storybook\]/);
assert.match(storybookVisualJob, /node run\.js --suite=storybook/);

const editorVisualJob = extractIndentedSection(ghaJobs, 'visual-editor', 2);
assert.match(editorVisualJob, /needs: \[build-linux\]/);
assert.match(editorVisualJob, /--suite=editor/);
assert.match(editorVisualJob, /--gdevelop-zip=/);

const publisherJob = extractIndentedSection(ghaJobs, 'publish-release', 2);
assert.match(publisherJob, /github\.event_name == 'push'[\s\S]*?refs\/tags\/gdng-v[\s\S]*?github\.event_name == 'pull_request'[\s\S]*?pull_request\.merged == true[\s\S]*?head\.repo\.full_name == github\.repository[\s\S]*?automation\/upstream-/);
for (const dependency of [
  'verify',
  'build-wasm',
  'core-sanitizers',
  'wasm-debug-sanitizers',
  'build-linux',
  'build-macos',
  'build-windows',
  'cli-html5-export',
  'visual-storybook',
  'visual-editor',
]) {
  assert.ok(
    publisherJob.includes('- ' + dependency),
    'Release publisher must wait for ' + dependency
  );
}
assert.match(publisherJob, /Resolve release version and tag/);
assert.match(publisherJob, /Create immutable tag for the merged upstream release/);
assert.ok(publisherJob.includes('steps.release-metadata.outputs.tag'));
assert.ok(publisherJob.includes('GDNG_SOURCE_SHA: ${{ env.GDNG_SOURCE_SHA }}'));
assert.match(publisherJob, /contents: write/);
assert.match(publisherJob, /GITHUB_TOKEN:/);
assert.match(publisherJob, /node scripts\/publish-gdng-release\.cjs/);

const dispatchValidation = extractIndentedSection(
  ghaJobs,
  'validate-dispatch',
  2
);
assert.match(dispatchValidation, /--validate-only/);
assert.match(
  releaseWorkflow,
  /release_tag:[\s\S]*?required: false/
);
assert.doesNotMatch(
  releaseWorkflow,
  /default: gdng-v/,
  'Manual validation must derive its default tag from the current package version, not a stale hard-coded version.'
);
assert.match(
  dispatchValidation,
  /inputs\.release_tag \|\| steps\.release-version\.outputs\.tag/
);
assert.doesNotMatch(publisherJob, /GDNG_GITHUB_TOKEN/);

const publisher = read('scripts/publish-gdng-release.cjs');
assert.match(publisher, /GITHUB_TOKEN/);
assert.match(publisher, /GDNG_SOURCE_SHA/);
assert.match(publisher, /GITHUB_REF_NAME/);
assert.match(publisher, /requireArchitecturePair/);
assert.ok(publisher.includes('async function resolveReleaseTagCommit()'));
assert.ok(publisher.includes("'/git/ref/tags/'"));
assert.ok(publisher.includes('taggedCommit !== sourceCommit'));
assert.match(publisher, /const publisherMarker = '<!-- gdng-release-publisher:v1:AiratGaliev\\/GDNG -->'/);
assert.match(publisher, /release\.body\.includes\(publisherMarker\)/);
assert.match(publisher, /publisherMarker,/);
assert.match(publisher, /--validate-only/);
assert.match(publisher, /gdng-v' \+ version/);
assert.match(publisher, /draft: false/);
assert.match(publisher, /SHA256SUMS\.txt/);
assert.doesNotMatch(publisher, /circleBuildUrl/);

const editorConfig = require(
  path.join(root, 'newIDE/electron-app/electron-builder-config.js')
);
assert.equal(
  editorConfig.electronDist,
  undefined,
  'electron-builder must resolve Electron separately for each target architecture; a single preinstalled dist is host-architecture-specific.'
);
assert.match(linuxJob, /readelf -h/);
assert.match(linuxJob, /dpkg-deb -f/);
assert.match(macosJob, /xcrun lipo -archs/);
const linuxTargets = editorConfig.linux.target
  .map(target => target.target)
  .sort();
assert.deepEqual(linuxTargets, ['AppImage', 'deb', 'zip']);
for (const target of editorConfig.linux.target) {
  assert.deepEqual([...target.arch].sort(), ['arm64', 'x64']);
}
assert.equal(editorConfig.mac.target.target, 'default');
assert.deepEqual(editorConfig.mac.target.arch, ['universal']);
assert.deepEqual(
  editorConfig.win.target.map(target => [target.target, ...target.arch]),
  [['nsis', 'x64'], ['zip', 'x64']]
);
assert.equal(editorConfig.appx, undefined);
assert.equal(editorConfig.appId, 'com.gdng.editor');

const cliExport = read('newIDE/app/scripts/test-portable-cli-export.js');
assert.match(cliExport, /portableZipName = 'gdng-' \+ version \+ '\.zip'/);
assert.match(cliExport, /github\.com\/AiratGaliev\/GDNG\/releases\/download\/gdng-v/);
assert.doesNotMatch(cliExport, /S3|s3/);

const windowsFallback = read('.github/workflows/build-portable-windows.yml');
const fallbackTriggers = extractTopLevelSection(windowsFallback, 'on');
assert.match(fallbackTriggers, /push:\s*\n\s+branches:\s*\n\s+- custom/);
assert.match(fallbackTriggers, /workflow_dispatch:/);

const upstreamSync = read('.github/workflows/sync-upstream-release.yml');
assert.match(upstreamSync, /branch="automation\/upstream-\$tag"/);
assert.match(upstreamSync, /git merge --abort/);
assert.match(upstreamSync, /grep -Fxq '\.circleci\/config\.yml'/);
const syncVerifierIndex = upstreamSync.indexOf('node scripts/verify-gdng-ci.cjs');
const syncPushIndex = upstreamSync.indexOf('git push --set-upstream origin "$branch"');
assert.ok(
  syncVerifierIndex >= 0 && syncPushIndex > syncVerifierIndex,
  'Upstream synchronization must run the GDNG CI verifier before pushing a merge candidate.'
);

console.log('GDNG CI and GitHub Release preservation verification passed.');
