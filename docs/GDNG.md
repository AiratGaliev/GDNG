# GDNG

GDNG is an independently maintained fork of [GDevelop](https://github.com/4ian/GDevelop). It is not an official GDevelop product and is not affiliated with the upstream project.

## Development

The normal contribution path is:

`topic branch → dev → test → main`

Start work from `dev`. Use `test` for integrated candidate validation and `main` for accepted releases. The `master` branch is a historical upstream snapshot; do not use it for GDNG development.

See [Development workflow](development-workflow.md) for the contribution and validation rules.

## GDNG-specific behavior

GDNG enables selected local editor features through `newIDE/app/src/Utils/LocalFeaturePolicy.js`, including debugger access, local preview features and project-level branding controls.

This changes local editor restrictions only. It does not grant cloud services, AI credits, publishing capacity or other server-side entitlements. Account permissions and API-provided limits remain controlled by GDevelop services.

The policy has a focused test in `newIDE/app/src/Utils/LocalFeaturePolicy.spec.js`.

## Local checks

Use Node.js 24 and npm. Follow the [editor setup instructions](../newIDE/README.md), then run these GDNG-specific checks from the repository root:

```sh
node scripts/verify-gdng-local-policy.cjs
node scripts/verify-gdng-ci.cjs
```

Run the relevant tests for the code you change. CI runs the required checks for every pull request.

## Upstream updates

An automated workflow prepares pull requests for published GDevelop releases. These updates are not merged automatically. Review the upstream changes and the GDNG-specific behavior, then merge only after the required checks pass.

Do not resolve conflicts in CI configuration by accepting one side wholesale. Preserve the GDNG workflows and verify the result.

## License and attribution

Keep upstream license files and copyright notices intact. GDevelop and its logo remain subject to the ownership and trademark notices in the upstream repository.
