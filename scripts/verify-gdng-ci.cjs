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

const wasmBuild = extractIndentedSection(
  circleJobs,
  'build-gdevelop_js-wasm-only',
  2
);
assert.match(
  wasmBuild,
  /persist_to_workspace:[\s\S]*?paths:[\s\S]*?- Binaries\/embuild\/GDevelop\.js/,
  'CircleCI branch validation must persist its exact-commit WebAssembly output.'
);

for (const jobName of ['build-linux', 'build-windows']) {
  assert.match(
    extractIndentedSection(circleJobs, jobName, 2),
    /attach_workspace:/,
    jobName + ' must consume the same-commit WebAssembly workspace.'
  );
}

const circleBuilds = extractIndentedSection(circleWorkflows, 'builds', 2);
assert.ok(circleBuilds.includes('      - build-gdevelop_js-wasm-only'));
assert.ok(
  circleBuilds.includes(
    '      - build-linux:\n          requires:\n            - build-gdevelop_js-wasm-only'
  ),
  'The main CircleCI Linux build must depend on current-commit WASM.'
);
assert.ok(
  circleBuilds.includes(
    '      - build-windows:\n          requires:\n            - build-gdevelop_js-wasm-only'
  ),
  'The main CircleCI Windows build must depend on current-commit WASM.'
);

const dailyWorkflow = extractIndentedSection(
  circleWorkflows,
  'daily-end-to-end-tests',
  2
);
assert.ok(dailyWorkflow.includes('      - build-gdevelop_js-wasm-only'));
assert.ok(
  dailyWorkflow.includes(
    '      - build-linux:\n          requires:\n            - build-gdevelop_js-wasm-only'
  ),
  'The daily Linux E2E workflow must build WASM before the editor package.'
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
assert.match(ghaTriggers, /workflow_dispatch:/);

const ghaJobs = extractTopLevelSection(releaseWorkflow, 'jobs');
const requiredGhaJobs = [
  'verify',
  'build-wasm',
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

const wasmJob = extractIndentedSection(ghaJobs, 'build-wasm', 2);
assert.match(wasmJob, /emsdk install 3\.1\.21/);
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

for (const [jobName, buildArg] of [
  ['build-linux', '--linux'],
  ['build-macos', '--mac'],
]) {
  const job = extractIndentedSection(ghaJobs, jobName, 2);
  assert.match(job, /needs: \[verify, build-wasm\]/);
  assert.match(job, /name: gdng-exact-commit-wasm/);
  assert.ok(job.includes('npm run build -- ' + buildArg), jobName + ' must invoke its configured electron-builder target.');
  assert.match(job, /actions\/upload-artifact@/);
}
const macosJob = extractIndentedSection(ghaJobs, 'build-macos', 2);
assert.match(macosJob, /runs-on: macos-15-intel/);
assert.doesNotMatch(macosJob, /runs-on: macos-14/);
assert.doesNotMatch(
  macosJob,
  /python3 -m pip install/,
  'macOS hosted runners use externally managed Homebrew Python; do not install setuptools with system pip.'
);
assert.match(releaseWorkflow, /^permissions:\s*\n  contents: read/m);
const windowsJob = extractIndentedSection(ghaJobs, 'build-windows', 2);
assert.match(windowsJob, /needs: \[verify, build-wasm\]/);
assert.match(windowsJob, /name: gdng-exact-commit-wasm/);
assert.match(windowsJob, /--win nsis --publish=never/);
assert.match(windowsJob, /--skip-app-build --win zip --publish=never/);
assert.match(windowsJob, /name: gdng-release-windows/);
assert.ok(
  windowsJob.indexOf('Push-Location GDevelop.js') >= 0 &&
    windowsJob.indexOf('Push-Location GDevelop.js') <
      windowsJob.indexOf('Push-Location newIDE/app'),
  'Windows must install GDevelop.js tooling before newIDE/app postinstall.'
);
const linuxJob = extractIndentedSection(ghaJobs, 'build-linux', 2);
assert.ok(
  linuxJob.indexOf('cd GDevelop.js') >= 0 &&
    linuxJob.indexOf('cd GDevelop.js') <
      linuxJob.indexOf('cd newIDE/app'),
  'Linux must install GDevelop.js tooling before newIDE/app postinstall.'
);
assert.ok(
  macosJob.indexOf('cd GDevelop.js') >= 0 &&
    macosJob.indexOf('cd GDevelop.js') <
      macosJob.indexOf('cd newIDE/app'),
  'macOS must install GDevelop.js tooling before newIDE/app postinstall.'
);

for (const [jobName, requiredArg] of [
  ['build-linux', '--linux'],
  ['build-macos', '--mac'],
  ['build-windows', '--win nsis'],
]) {
  const job = extractIndentedSection(ghaJobs, jobName, 2);
  assert.ok(job.includes(requiredArg), jobName + ' is missing its platform build target.');
}

const cliJob = extractIndentedSection(ghaJobs, 'cli-html5-export', 2);
assert.match(cliJob, /needs: \[build-linux\]/);
assert.match(cliJob, /--zipPath=/);
assert.match(cliJob, /xvfb-run/);

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
assert.match(publisherJob, /contents: write/);
assert.match(publisherJob, /GITHUB_TOKEN:/);
assert.match(publisherJob, /node scripts\/publish-gdng-release\.cjs/);

const dispatchValidation = extractIndentedSection(
  ghaJobs,
  'validate-dispatch',
  2
);
assert.match(dispatchValidation, /--validate-only/);
assert.doesNotMatch(publisherJob, /GDNG_GITHUB_TOKEN/);

const publisher = read('scripts/publish-gdng-release.cjs');
assert.match(publisher, /GITHUB_TOKEN/);
assert.match(publisher, /GITHUB_REF_NAME/);
assert.match(publisher, /requireArchitecturePair/);
assert.match(publisher, /--validate-only/);
assert.match(publisher, /gdng-v' \+ version/);
assert.match(publisher, /draft: false/);
assert.match(publisher, /SHA256SUMS\.txt/);
assert.doesNotMatch(publisher, /circleBuildUrl/);

const editorConfig = require(
  path.join(root, 'newIDE/electron-app/electron-builder-config.js')
);
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
assert.match(fallbackTriggers, /workflow_dispatch:/);
assert.doesNotMatch(fallbackTriggers, /^  push:/m);

const upstreamSync = read('.github/workflows/sync-upstream-release.yml');
assert.match(upstreamSync, /git merge --abort/);
assert.match(upstreamSync, /grep -Fxq '\.circleci\/config\.yml'/);
const syncVerifierIndex = upstreamSync.indexOf('node scripts/verify-gdng-ci.cjs');
const syncPushIndex = upstreamSync.indexOf('git push --set-upstream origin "$branch"');
assert.ok(
  syncVerifierIndex >= 0 && syncPushIndex > syncVerifierIndex,
  'Upstream synchronization must run the GDNG CI verifier before pushing a merge candidate.'
);

console.log('GDNG CI and GitHub Release preservation verification passed.');
