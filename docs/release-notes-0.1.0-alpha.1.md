# Ribbit 0.1.0-alpha.1

Ribbit's first open-source preview: composable semantic shell commands with typed records, explicit model routing, reusable YAML definitions, linear flows, and trusted TypeScript extensions.

Use a local model for a bounded intermediate task, retain its source evidence, then pass the result to a stronger model or coding harness. The included recipes demonstrate feedback triage, source-context handoff, and reusable transformations. Exact commands work without a model.

## Install

Install from [npm](https://www.npmjs.com/package/@funsaized/ribbit):

```sh
npm install -g @funsaized/ribbit@alpha
ribbit --help
```

The npm wrapper requires Node.js >=20 and tar. It downloads the matching native asset from this GitHub release and verifies pinned checksums. Native CI tests the packed npm installation on every advertised target.

Alternatively, download the archive matching your OS and CPU from this release, verify its `.sha256` sidecar, and extract it. Keep `ribbit` (or `ribbit.exe`) beside `lib/`. No separate JavaScript runtime is required for ordinary commands. Interactive `pick` requires fzf >=0.74.3.

Native targets: Linux glibc x64/ARM64, macOS Intel/Apple Silicon, and Windows x64/ARM64. The CI matrix builds, tests, packages, and runs isolated archive checks on each target. The Windows interactive console picker is not covered by the POSIX PTY tests; use noninteractive `rank --top` in automation. macOS binaries are ad-hoc signed, not notarized; Windows binaries are not Authenticode signed.

## Evidence and limits

The native CI gate checks the applicable deterministic tests on each platform. See [current model evidence](models.md) for the replacement local baseline, including failed attempts and pending factual review. Those runs identify their actual binaries and do not certify this published release build; native CI validates the release revision separately.

This is an alpha, not a broad semantic reliability or API stability promise. Small models can return valid but wrong answers. Chaining did not automatically improve speed or reduce context in these fixtures. Preserve original evidence when downstream review matters. Independent quality review and new-user pilots remain follow-up work.

Licensed under MIT. Model weights are not included. Installed extensions are trusted code, not sandboxed plugins. There is no automatic cloud fallback, telemetry, or model download.

Documentation: https://funsaized.github.io/ribbit/

The searchable documentation site separates tutorials, how-to guides, reference, and explanation. It includes guided first results, local-model composition, reusable commands, and explanations of each supplied workflow.
Security reports: https://github.com/funsaized/ribbit/security/advisories/new
