export const CROWDIN_PROJECT_IDS = Object.freeze({
  gdevelop: 79367,
  gdng: 948159,
});

function parseProjectId(value, variableName) {
  const raw = String(value ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(variableName + ' must be a positive integer project ID.');
  }

  const projectId = Number(raw);
  if (!Number.isSafeInteger(projectId)) {
    throw new Error(variableName + ' is outside the safe integer range.');
  }
  return projectId;
}

/**
 * Allow an optional environment override only when it matches the pinned ID.
 * In particular, a secret cannot redirect GDNG writes to upstream GDevelop.
 */
export function assertProjectId(value, expectedId, variableName) {
  const hasOverride = value !== undefined && value !== null && String(value).trim() !== '';
  const projectId = hasOverride ? parseProjectId(value, variableName) : expectedId;

  if (projectId !== expectedId) {
    if (projectId === CROWDIN_PROJECT_IDS.gdevelop && expectedId === CROWDIN_PROJECT_IDS.gdng) {
      throw new Error(
        variableName + ' points to upstream GDevelop (' + CROWDIN_PROJECT_IDS.gdevelop +
        '), which is read-only. GDNG (' + CROWDIN_PROJECT_IDS.gdng + ') is the only allowed destination.'
      );
    }
    throw new Error(variableName + ' must identify project ' + expectedId + ', not ' + projectId + '.');
  }
  return expectedId;
}

export function assertGdngProjectId(value) {
  const projectId = parseProjectId(value, 'CROWDIN_PROJECT_ID');
  if (projectId === CROWDIN_PROJECT_IDS.gdevelop) {
    throw new Error(
      'Refusing to use upstream GDevelop Crowdin project ' + projectId +
      ' as a destination. GDevelop is read-only; only GDNG project ' +
      CROWDIN_PROJECT_IDS.gdng + ' may be written.'
    );
  }
  if (projectId !== CROWDIN_PROJECT_IDS.gdng) {
    throw new Error('CROWDIN_PROJECT_ID must identify GDNG project ' + CROWDIN_PROJECT_IDS.gdng + '.');
  }
  return projectId;
}

function assertProjectIdentity(project, expected) {
  if (!project || Number(project.id) !== expected.id) {
    throw new Error('Crowdin project identity mismatch: expected ' + expected.name + ' (' + expected.id + ').');
  }
  if (project.name !== expected.name) {
    throw new Error('Crowdin project ' + expected.id + ' has unexpected name ' + JSON.stringify(project.name) + '.');
  }
  if (expected.identifier && project.identifier !== expected.identifier) {
    throw new Error('Crowdin project ' + expected.id + ' has an unexpected identifier.');
  }
  if (expected.sourceLanguageId && project.sourceLanguageId !== expected.sourceLanguageId) {
    throw new Error('Crowdin project ' + expected.id + ' must use source language ' + expected.sourceLanguageId + '.');
  }
  return project;
}

export function assertGdngProject(project) {
  return assertProjectIdentity(project, {
    id: CROWDIN_PROJECT_IDS.gdng,
    name: 'GDNG',
    sourceLanguageId: 'en',
  });
}

export function assertCrowdinProjectPair(sourceProject, targetProject) {
  assertProjectIdentity(sourceProject, {
    id: CROWDIN_PROJECT_IDS.gdevelop,
    name: 'GDevelop 5',
    identifier: 'gdevelop',
    sourceLanguageId: 'en',
  });
  assertGdngProject(targetProject);
  if (Number(sourceProject.id) === Number(targetProject.id)) {
    throw new Error('Source and destination Crowdin projects must be different.');
  }
}
