'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repository = 'AiratGaliev/GDNG';
const workflowPath = 'release-multiplatform.yml';
const artifactName = 'gdng-release-linux';
const projectRoot = path.resolve(__dirname, '..', '..');

function runGh(args) {
  const result = spawnSync('gh', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error && result.error.code === 'ENOENT') {
    throw new Error(
      'GitHub CLI (gh) is required to download the latest GDNG build artifact. ' +
      'Install https://cli.github.com/ and run gh auth login.'
    );
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || (result.error && result.error.message) || '').trim();
    throw new Error(
      'GitHub CLI command failed: gh ' + args.join(' ') +
      (detail ? '\\n' + detail : '') +
      '\\nAuthenticate with gh auth login or provide GH_TOKEN with actions:read access.'
    );
  }
  return result.stdout;
}

function findPortableZip(directory) {
  const pending = [directory];
  const matches = [];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (
        entry.isFile() &&
        /^gdng-.+\\.zip$/i.test(entry.name) &&
        !/-arm64\\.zip$/i.test(entry.name)
      ) {
        matches.push(fullPath);
      }
    }
  }
  matches.sort();
  return matches[0] || null;
}

/**
 * Download the latest unexpired Linux portable artifact from a successful
 * validation run on main. Ordinary main builds are CI artifacts, not releases.
 *
 * @param {{ outputDirectory: string, log?: (message: string) => void }} options
 * @returns {string} Path to the x64 Linux portable ZIP.
 */
function downloadLatestMainLinuxArtifact({ outputDirectory, log = () => {} }) {
  const runsResponse = JSON.parse(
    runGh([
      'api',
      'repos/' + repository + '/actions/workflows/' + workflowPath +
        '/runs?branch=main&status=completed&per_page=100',
    ])
  );
  const runs = (runsResponse.workflow_runs || [])
    .filter(run => run.conclusion === 'success' && run.head_branch === 'main')
    .sort((left, right) =>
      String(right.run_started_at || right.created_at).localeCompare(
        String(left.run_started_at || left.created_at)
      )
    );

  for (const run of runs.slice(0, 10)) {
    const artifactsResponse = JSON.parse(
      runGh([
        'api',
        'repos/' + repository + '/actions/runs/' + run.id + '/artifacts',
      ])
    );
    const artifact = (artifactsResponse.artifacts || []).find(
      candidate => candidate.name === artifactName && !candidate.expired
    );
    if (!artifact) continue;

    const destination = path.resolve(outputDirectory, 'main-run-' + run.id);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });
    log(
      'Downloading ' + artifactName + ' from successful main run ' +
      run.id + ' (' + run.head_sha + ').'
    );
    runGh([
      'run',
      'download',
      String(run.id),
      '--repo',
      repository,
      '--name',
      artifactName,
      '--dir',
      destination,
    ]);

    const zipPath = findPortableZip(destination);
    if (!zipPath) {
      throw new Error(
        'Downloaded artifact ' + artifactName + ' from run ' + run.id +
        ', but no x64 gdng-*.zip was found in ' + destination + '.'
      );
    }
    log('Using portable build ' + path.basename(zipPath) + ' from main run ' + run.id + '.');
    return zipPath;
  }

  throw new Error(
    'No successful main validation run with an unexpired ' + artifactName +
    ' artifact was found. Run the release-multiplatform workflow on main first, ' +
    'or pass --gdevelop-zip with a local portable ZIP.'
  );
}

module.exports = { downloadLatestMainLinuxArtifact };
