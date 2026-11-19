'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repository = 'AiratGaliev/GDNG';
const version = require(path.join(
  root,
  'newIDE/electron-app/app/package.json'
)).version;
const expectedTag = 'gdng-v' + version;
const publisherMarker = '<!-- gdng-release-publisher:v1:AiratGaliev/GDNG -->';
const tag =
  process.env.GDNG_RELEASE_TAG ||
  process.env.CIRCLE_TAG ||
  process.env.GITHUB_REF_NAME;
const token = process.env.GDNG_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
const validateOnly = process.argv.includes('--validate-only');
const sourceCommit =
  process.env.GDNG_SOURCE_SHA ||
  process.env.CIRCLE_SHA1 ||
  process.env.GITHUB_SHA ||
  'unknown';
const buildUrl =
  process.env.CIRCLE_BUILD_URL ||
  (process.env.GITHUB_SERVER_URL &&
  process.env.GITHUB_REPOSITORY &&
  process.env.GITHUB_RUN_ID
    ? process.env.GITHUB_SERVER_URL +
      '/' +
      process.env.GITHUB_REPOSITORY +
      '/actions/runs/' +
      process.env.GITHUB_RUN_ID
    : 'CI');

if (!tag || tag !== expectedTag) {
  throw new Error(
    'Release tag must exactly match ' + expectedTag + '; received ' + (tag || '(empty)')
  );
}
if (!token && !validateOnly) {
  throw new Error(
    'GitHub release token is missing. Provide GITHUB_TOKEN with contents:write or GDNG_GITHUB_TOKEN.'
  );
}

const releaseRoot = path.join(root, 'release-artifacts');
const platformDirectories = {
  macos: path.join(releaseRoot, 'macos'),
  linux: path.join(releaseRoot, 'linux'),
  windows: path.join(releaseRoot, 'windows'),
};

function listFiles(directory, extensions) {
  if (!fs.existsSync(directory)) {
    throw new Error('Missing platform artifact directory: ' + directory);
  }
  const allowedExtensions = extensions.map(extension => extension.toLowerCase());
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      entry =>
        entry.isFile() &&
        allowedExtensions.some(extension =>
          entry.name.toLowerCase().endsWith(extension)
        )
    )
    .map(entry => path.join(directory, entry.name))
    .sort();
}

function requireArchitecturePair(files, extension, platform) {
  const matching = files.filter(file =>
    path.basename(file).toLowerCase().endsWith(extension.toLowerCase())
  );
  const arm64 = matching.filter(file =>
    path.basename(file).toLowerCase().includes('arm64')
  );
  const x64 = matching.filter(file =>
    !path.basename(file).toLowerCase().includes('arm64')
  );
  if (arm64.length !== 1 || x64.length !== 1) {
    throw new Error(
      platform + ' must provide exactly one x64 and one arm64 ' + extension +
      ' asset; found x64=' + x64.length + ', arm64=' + arm64.length
    );
  }
}

function requireCount(files, extension, minimum, platform) {
  const found = files.filter(file =>
    file.toLowerCase().endsWith(extension.toLowerCase())
  );
  if (found.length < minimum) {
    throw new Error(
      platform + ' release requires at least ' + minimum + ' ' + extension +
      ' file(s); found ' + found.length
    );
  }
}

function githubRequest(method, endpoint, payload) {
  const url = new URL(endpoint, 'https://api.github.com');
  const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'User-Agent': 'GDNG-release-publisher',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = body.length;
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      },
      response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = { message: text };
            }
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(
              method + ' ' + url.pathname + ' failed (' +
              response.statusCode + '): ' +
              (data && data.message ? data.message : text)
            );
            error.statusCode = response.statusCode;
            reject(error);
            return;
          }
          resolve(data);
        });
      }
    );
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function uploadAsset(releaseId, filePath) {
  const filename = path.basename(filePath);
  const stat = fs.statSync(filePath);
  const url = new URL(
    'https://uploads.github.com/repos/' + repository +
    '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(filename)
  );

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'Content-Length': stat.size,
          'Content-Type': 'application/octet-stream',
          'User-Agent': 'GDNG-release-publisher',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = { message: text };
            }
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                'Uploading ' + filename + ' failed (' + response.statusCode +
                '): ' + (data && data.message ? data.message : text)
              )
            );
            return;
          }
          resolve(data);
        });
      }
    );
    request.on('error', reject);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.pipe(request);
  });
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  const assetsByPlatform = {
    macos: listFiles(platformDirectories.macos, ['.dmg', '.zip']),
    linux: listFiles(platformDirectories.linux, ['.appimage', '.deb', '.zip']),
    windows: listFiles(platformDirectories.windows, ['.exe', '.zip']),
  };

  requireCount(assetsByPlatform.macos, '.dmg', 1, 'macOS');
  requireCount(assetsByPlatform.macos, '.zip', 1, 'macOS');
  requireCount(assetsByPlatform.linux, '.AppImage', 2, 'Linux');
  requireCount(assetsByPlatform.linux, '.deb', 2, 'Linux');
  requireCount(assetsByPlatform.linux, '.zip', 2, 'Linux');
  requireArchitecturePair(assetsByPlatform.linux, '.AppImage', 'Linux');
  requireArchitecturePair(assetsByPlatform.linux, '.deb', 'Linux');
  requireArchitecturePair(assetsByPlatform.linux, '.zip', 'Linux');
  requireCount(assetsByPlatform.windows, '.exe', 1, 'Windows');
  requireCount(assetsByPlatform.windows, '.zip', 1, 'Windows');

  const assets = Object.entries(assetsByPlatform).flatMap(([platform, files]) =>
    files.map(file => ({ platform, file }))
  );
  const duplicateNames = new Set();
  const seenNames = new Set();
  for (const asset of assets) {
    const filename = path.basename(asset.file);
    const normalizedFilename = filename.toLowerCase();
    if (seenNames.has(normalizedFilename)) duplicateNames.add(filename);
    seenNames.add(normalizedFilename);
  }
  if (duplicateNames.size) {
    throw new Error(
      'Platform outputs contain duplicate release asset names: ' +
      [...duplicateNames].join(', ')
    );
  }
  for (const asset of assets) {
    if (fs.statSync(asset.file).size <= 0) {
      throw new Error('Release asset is empty: ' + asset.file);
    }
  }

  const builtAtUtc = new Date().toISOString();
  const metadataPath = path.join(releaseRoot, 'gdng-release-metadata.json');
  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        product: 'GDNG',
        version,
        tag,
        repository,
        sourceCommit,
        buildUrl,
        builtAtUtc,
        signed: false,
        platforms: {
          windows: ['x64'],
          linux: ['x64', 'arm64'],
          macos: ['universal'],
        },
      },
      null,
      2
    ) + '\n'
  );
  assets.push({ platform: 'metadata', file: metadataPath });

  const checksumLines = [];
  for (const asset of assets) {
    const digest = await sha256(asset.file);
    checksumLines.push(digest + '  ' + path.basename(asset.file));
  }
  const checksumsPath = path.join(releaseRoot, 'SHA256SUMS.txt');
  fs.writeFileSync(checksumsPath, checksumLines.join('\n') + '\n');
  assets.push({ platform: 'metadata', file: checksumsPath });

  if (validateOnly) {
    console.log(
      'Release asset validation passed for ' + tag + ': ' +
      assets.length + ' non-empty files across macOS, Linux and Windows.'
    );
    return;
  }

  let release;
  try {
    release = await githubRequest(
      'GET',
      '/repos/' + repository + '/releases/tags/' + encodeURIComponent(tag)
    );
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }

  if (release && !release.draft) {
    throw new Error(
      'GitHub Release ' + tag + ' is already published. Create a new version tag instead of replacing it.'
    );
  }

  if (
    release &&
    release.draft &&
    (release.name !== 'GDNG v' + version ||
      typeof release.body !== 'string' ||
      !release.body.includes(publisherMarker))
  ) {
    throw new Error(
      'Existing draft release ' + tag +
      ' is not owned by this publisher; refusing to delete its assets.'
    );
  }

  if (release && release.assets) {
    for (const asset of release.assets) {
      await githubRequest(
        'DELETE',
        '/repos/' + repository + '/releases/assets/' + asset.id
      );
    }
  }

  if (!release) {
    release = await githubRequest('POST', '/repos/' + repository + '/releases', {
      tag_name: tag,
      name: 'GDNG v' + version,
      draft: true,
      prerelease: false,
      body: [
        'Cross-platform GDNG desktop release built from commit ' + sourceCommit + '.',
        '',
        '- Windows x64: unsigned NSIS installer and portable ZIP.',
        '- Linux x64/arm64: AppImage, DEB and portable ZIP.',
        '- macOS: universal DMG and ZIP.',
        '',
        'All binaries are unsigned. Windows SmartScreen and macOS Gatekeeper warnings may appear.',
        '',
        'Build: ' + buildUrl,
        publisherMarker,
      ].join('\n'),
    });
  }

  console.log(
    'Uploading ' + assets.length + ' verified assets to draft release ' + tag + '.'
  );
  for (const asset of assets) {
    console.log(
      'Uploading ' + path.basename(asset.file) + ' (' +
      fs.statSync(asset.file).size + ' bytes)...'
    );
    const uploaded = await uploadAsset(release.id, asset.file);
    console.log('Uploaded ' + uploaded.name + ' (' + uploaded.size + ' bytes).');
  }

  release = await githubRequest(
    'PATCH',
    '/repos/' + repository + '/releases/' + release.id,
    { draft: false }
  );
  console.log('Published ' + release.html_url);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
