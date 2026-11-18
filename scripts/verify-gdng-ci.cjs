const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const circleci = read('.circleci/config.yml');

function extractTopLevelSection(source, name) {
  const startPattern = new RegExp('^' + name + ':\\s*$', 'm');
  const startMatch = startPattern.exec(source);
  assert.ok(startMatch, 'Missing top-level CircleCI section: ' + name);

  const contentStart = startMatch.index + startMatch[0].length;
  const remainder = source.slice(contentStart);
  const nextSection = /^\S[^\r\n]*:\s*$/m.exec(remainder);
  return nextSection ? remainder.slice(0, nextSection.index) : remainder;
}

function extractJob(jobs, name) {
  const startPattern = new RegExp('^  ' + name + ':\\s*$', 'm');
  const startMatch = startPattern.exec(jobs);
  assert.ok(startMatch, 'Missing CircleCI job: ' + name);

  const contentStart = startMatch.index + startMatch[0].length;
  const remainder = jobs.slice(contentStart);
  const nextJob = /^  [A-Za-z0-9_-]+:\s*$/m.exec(remainder);
  return nextJob ? remainder.slice(0, nextJob.index) : remainder;
}

function extractWorkflow(workflows, name) {
  const startPattern = new RegExp('^  ' + name + ':\\s*$', 'm');
  const startMatch = startPattern.exec(workflows);
  assert.ok(startMatch, 'Missing CircleCI workflow: ' + name);

  const contentStart = startMatch.index + startMatch[0].length;
  const remainder = workflows.slice(contentStart);
  const nextWorkflow = /^  [A-Za-z0-9_-]+:\s*$/m.exec(remainder);
  return nextWorkflow ? remainder.slice(0, nextWorkflow.index) : remainder;
}

const jobs = extractTopLevelSection(circleci, 'jobs');
const workflows = extractTopLevelSection(circleci, 'workflows');

const requiredJobs = [
  'verify-gdng-ci',
  'build-macos',
  'build-linux',
  'build-gdevelop_js-wasm-only',
  'build-gdevelop_js-debug-sanitizers-and-extra-checks',
  'build-gdcore-tests-sanitizers',
  'build-windows',
  'publish-gdng-release',
  'run-cli-html5-export-linux',
  'build-storybook-for-visual-tests',
  'run-visual-monkey-tests-storybook-linux',
  'run-visual-monkey-tests-editor-linux',
];
for (const jobName of requiredJobs) extractJob(jobs, jobName);

const wasmBuild = extractJob(jobs, 'build-gdevelop_js-wasm-only');
assert.match(
  wasmBuild,
  /persist_to_workspace:[\s\S]*?paths:[\s\S]*?- Binaries\/embuild\/GDevelop\.js/,
  'The WebAssembly build must persist its exact-commit output.'
);

for (const jobName of ['build-linux', 'build-windows']) {
  assert.match(
    extractJob(jobs, jobName),
    /attach_workspace:/,
    jobName + ' must consume the same-commit WebAssembly workspace.'
  );
}

const macBuild = extractJob(jobs, 'build-macos');
const linuxBuild = extractJob(jobs, 'build-linux');
const windowsBuild = extractJob(jobs, 'build-windows');

for (const [jobName, job] of [
  ['macOS', macBuild],
  ['Linux', linuxBuild],
  ['Windows', windowsBuild],
]) {
  assert.match(job, /publish-release-assets:[\s\S]*?default: false/);
}

assert.match(macBuild, /condition: << parameters\.publish-release-assets >>/);
assert.match(macBuild, /release-artifacts\/macos/);

assert.match(linuxBuild, /gdng-\*\.zip/);
assert.match(linuxBuild, /"<< parameters\.publish-release-assets >>" = "true"/);
assert.match(linuxBuild, /release-artifacts\/linux/);

assert.match(windowsBuild, /condition: << parameters\.publish-release-assets >>/);
assert.match(windowsBuild, /release-artifacts\\windows/);
assert.match(windowsBuild, /--win nsis --publish=never/);
assert.match(windowsBuild, /--win zip --publish=never/);
assert.doesNotMatch(windowsBuild, /appx|eSigner|ESIGNER/i);

assert.match(circleci, /origin\/custom/);
assert.match(circleci, /- custom/);
assert.doesNotMatch(circleci, /aws-cli\/setup|aws s3 sync/i);

const requiredWorkflows = [
  'ci-validation',
  'gdevelop_js-wasm-extra-checks',
  'tests',
  'builds',
  'daily-end-to-end-tests',
  'all-visual-tests',
  'changed-visual-tests',
  'gdng-release',
];
for (const workflowName of requiredWorkflows) {
  assert.match(
    workflows,
    new RegExp('^  ' + workflowName + ':\\s*$', 'm'),
    'Missing CircleCI workflow: ' + workflowName
  );
}

const buildsWorkflow = extractWorkflow(workflows, 'builds');
assert.ok(buildsWorkflow.includes('      - build-gdevelop_js-wasm-only'));
assert.ok(
  buildsWorkflow.includes(
    '      - build-linux:\n          requires:\n            - build-gdevelop_js-wasm-only'
  ),
  'The main Linux build must depend on the current-commit WASM artifact.'
);
assert.ok(
  buildsWorkflow.includes(
    '      - build-windows:\n          requires:\n            - build-gdevelop_js-wasm-only'
  ),
  'The main Windows build must depend on the current-commit WASM artifact.'
);

const dailyWorkflow = extractWorkflow(workflows, 'daily-end-to-end-tests');
assert.ok(dailyWorkflow.includes('      - build-gdevelop_js-wasm-only'));
assert.ok(
  dailyWorkflow.includes(
    '      - build-linux:\n          requires:\n            - build-gdevelop_js-wasm-only'
  ),
  'The daily Linux E2E workflow must build WASM before the editor package.'
);

const verificationJob = extractJob(jobs, 'verify-gdng-ci');
assert.match(verificationJob, /node scripts\/verify-gdng-ci\.cjs/);
assert.match(verificationJob, /node scripts\/verify-gdng-local-policy\.cjs/);
assert.match(verificationJob, /node --check scripts\/publish-gdng-release\.cjs/);

const publisherJob = extractJob(jobs, 'publish-gdng-release');
assert.match(publisherJob, /attach_workspace:/);
assert.match(publisherJob, /node scripts\/publish-gdng-release\.cjs/);

const releaseWorkflow = workflows.slice(workflows.indexOf('  gdng-release:'));
assert.ok(releaseWorkflow.includes('ignore: /.*/'));
assert.ok(
  releaseWorkflow.includes('only: /^gdng-v[0-9]+\\.[0-9]+\\.[0-9]+$/'),
  'Release workflow must accept only exact gdng-v<semver> tags.'
);
assert.match(releaseWorkflow, /- build-macos:\s*\n\s*publish-release-assets: true/);
assert.match(releaseWorkflow, /- build-linux:[\s\S]*?publish-release-assets: true/);
assert.match(releaseWorkflow, /- build-windows:[\s\S]*?publish-release-assets: true/);

for (const requiredJob of [
  'verify-gdng-ci',
  'build-macos',
  'build-linux',
  'build-windows',
  'build-gdcore-tests-sanitizers',
  'build-gdevelop_js-debug-sanitizers-and-extra-checks',
  'release-cli-html5-export-linux',
  'release-visual-monkey-tests-editor-linux',
  'publish-gdng-release',
]) {
  assert.ok(
    releaseWorkflow.includes(requiredJob),
    'GitHub Release workflow must include ' + requiredJob
  );
}

const publisher = read('scripts/publish-gdng-release.cjs');
assert.match(publisher, /GDNG_GITHUB_TOKEN/);
assert.match(publisher, /requireArchitecturePair/);
assert.match(publisher, /--validate-only/);
assert.match(publisher, /gdng-v' \+ version/);
assert.match(publisher, /draft: false/);
assert.match(publisher, /SHA256SUMS\.txt/);

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
const triggers = extractTopLevelSection(windowsFallback, 'on');
assert.match(triggers, /workflow_dispatch:/);
assert.doesNotMatch(triggers, /^  push:/m);

const upstreamSync = read('.github/workflows/sync-upstream-release.yml');
assert.match(upstreamSync, /git merge --abort/);
assert.match(upstreamSync, /grep -Fxq '\.circleci\/config\.yml'/);
const syncVerifierIndex = upstreamSync.indexOf('node scripts/verify-gdng-ci.cjs');
const syncPushIndex = upstreamSync.indexOf('git push --set-upstream origin "$branch"');
assert.ok(
  syncVerifierIndex >= 0 && syncPushIndex > syncVerifierIndex,
  'Upstream synchronization must run the GDNG CI verifier before pushing a merge candidate.'
);

console.log('GDNG CI and release preservation verification passed.');
