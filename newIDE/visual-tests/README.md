# Visual tests

Visual tests exercise the editor in a browser and check that user interactions leave it in a valid state.

## Test suites

| Suite | What it tests |
|---|---|
| `storybook` | Individual editor components and their displayed state |
| `editor` | The packaged editor opening and editing a real project |

Use Storybook tests for precise component checks. Use editor tests for end-to-end smoke coverage.

## Run tests

From this directory:

```sh
npm install
node run.js --list
node run.js --suite=storybook
node run.js --suite=editor --gdevelop-zip=../electron-app/dist/<package>.zip
```

To run the editor suite without `--gdevelop-zip`, install and authenticate the GitHub CLI (`gh auth login`). The runner downloads the latest successful Linux build from `main`. That build does not include unmerged changes from your branch; pass a package built from your changes when testing those changes.

Useful options:

| Option | Purpose |
|---|---|
| `--test=<name>` | Run tests whose names contain the given text |
| `--headful` | Show the browser while tests run |
| `--verbose` | Log each test action |
| `--storybook-url=<url>` | Use an already running Storybook |
| `--rebuild-storybook` | Rebuild Storybook before testing |
| `--gdevelop-zip=<path>` | Use a specific packaged editor |
| `--artifacts-dir=<path>` | Choose where screenshots and logs are written |
| `--only-changed --base-ref=<ref>` | Run tests related to changes from the selected base |

## CI

Pull requests run the Storybook tests related to the changed code. Changing test files runs the full Storybook suite. The full visual validation runs for integrated candidates on `test` and `main`.

The editor suite on a development branch uses the latest successful package from `main`, unless a package is supplied explicitly. The full validation on `test` and `main` tests the package built from that commit.

## Add a test

Test files in `storybook-tests/` and `editor-tests/` export arrays of test cases.

A Storybook test uses a helper, a story and a sequence of actions:

```js
const spriteEditor = require('../helpers/SpriteEditor');

module.exports = [
  {
    name: 'sprite-editor/delete-animations',
    helper: spriteEditor,
    story: 'objecteditor-spriteeditormanipulations--manipulations',
    steps: [
      ['selectFrames', { row: 1, frames: [0, 1] }],
      ['deleteAnimation', { row: 0 }],
    ],
  },
];
```

Editor tests use the same helpers while driving the packaged application. Put editor-specific actions and checks in `helpers/`; keep shared browser and test-running logic in `lib/`. Set `paths` on a test or helper to tell CI which source files it covers. Tests without watched paths run on every relevant CI run.

Tests should verify both the action and its result. A test must fail when the editor reports an error, disappears, or does not reach the expected state.

Known unrelated issues are listed in `lib/KnownIssues.js`. They are reported but do not fail the run; remove an entry when the issue is fixed.
