# First open-source release checklist

Version **0.1.0-alpha.1** is an MIT-licensed experimental preview, authorized for public release on 2026-09-20 with all 22 commands and the Ribbit name. Independent semantic review and a new-user pilot are follow-up work. Each advertised archive must pass native verification before publication.

## Product and architecture

Ribbit composes typed shell commands, local-model tasks, stronger-model steps, and explicit harness handoffs. CLI adapters produce typed records; the engine applies schemas, routing, budgets, and cancellation. Built-ins and trusted extensions share the SDK contract. YAML definitions and linear flows reuse those commands with explicit routes. Output adapters retain record metadata until a deliberate export boundary. See [product direction](product-direction.md) and [recipes](recipes.md).

## Acceptance evidence

| Area | Evidence | Status |
| --- | --- | --- |
| 22 original built-ins + `where` | [Individual matrix](release-acceptance.md), [packaged cases](../tests/release/commands.test.ts), [`where` flow](../tests/release/squirrels.test.ts) | Original per-command cases and additional exact selector tested separately; semantic suitability remains profile-specific |
| Management surfaces | [Lifecycle tests](../tests/release/management.test.ts) | Packaged configuration/discovery/extension/definition lifecycle |
| Composition | [Recipe tests](../tests/release/recipes.test.ts) | Real shell pipes, inline and saved flows agree; routes, originals, metadata, and budgets asserted |
| Local model evidence | [Per-command results](models.md) | Every semantic command and optional semantic mode exercised; failed attempts retained |
| Three product recipes | [Runnable guide](recipes.md), [model comparison](models.md) | Local-only/direct-stronger/mixed outputs and overhead measured on shared synthetic fixtures |
| External harness | [Model/harness evidence](models.md) | Current local Codex read-only stdin handoff recorded; source correctness requires review, not keyword presence |
| Isolated distribution | [Smoke runner](../scripts/smoke.ts) | Copied binary/lib and isolated HOME/XDG paths; no maintainer config |
| Usage documentation | [Documentation hub](index.md), [strict site build](../.github/workflows/docs.yml) | Diátaxis navigation, searchable site, and repository Markdown links checked |
| Contributor and security guidance | [Contributing](../CONTRIBUTING.md), [security](../SECURITY.md) | MIT adopted; private reporting enabled for the public repository |
| CI | [Workflow](../.github/workflows/ci.yml) in source checkout | Native matrix covers Linux/macOS/Windows on x64/ARM64; see the linked Actions run for results |
| npm distribution | `bun run package:npm:verify` | Packed installation, checksum rejection, command mapping, and extension authoring checked on each native target |
| Release archive | `bun run package:release` | Binary/lib, curated public docs, source/fixtures, notices, BUILD metadata, checksum; uploaded only after successful native CI |

Run `bun run verify` for the deterministic gate, then `bun run package:release && bun run package:verify` for distribution checks. Live model evaluations are separately opt-in. The [native Actions run](https://github.com/funsaized/ribbit/actions) for the release revision is the build and test authority; archives record that revision in `BUILD.json`.

## What the evidence supports

The [current-state baseline](../evals/README.md) separates deterministic passes, failures, and pending source-grounded review. Neither local model has automatic factual acceptance while required prose judgments remain pending. The supplied annotation recipes preserve evidence and allow downstream review, but do not establish speed, cost, or general quality improvement over direct stronger-model calls.

The original 22-command scope is retained; `where` adds a 23rd exact selector with separate packaged flow coverage. Exact modes can be presented with their tested deterministic contracts. Semantic commands should remain experimental and tied to measured profiles. Version `0.1.0-alpha.1` is an experimental preview; no 1.0 promise is introduced.

## Resolved release decisions and follow-up work

- MIT license, attributed to Sai Nimmagadda using the existing repository author identity.
- Public experimental preview authorized; publish on the configured `funsaized/ribbit` GitHub remote.
- Keep Ribbit as the product/executable name. The source checkout stays `private: true` to prevent accidental publication of the repository package. A separate staged public npm package, `@funsaized/ribbit`, installs the native GitHub assets with pinned checksums. Both GitHub and npm publication are authorized.
- Independent held-out semantic review and a fresh-user pilot remain follow-up work. No broad quality or onboarding claim is made from synthetic tests.
- Native CI builds and tests all six desktop targets. macOS binaries are ad-hoc signed, not Apple Developer ID signed/notarized. Windows binaries are not Authenticode signed. Interactive picker validation uses real PTYs on Linux/macOS; Windows console interaction remains separately documented.

## Preview limitations

Trusted extensions have no sandbox. Semantic prompt injection is not solved. Input size limits may exceed a model's context window. Token usage can be unknown. Global ranking/grouping are bounded operations. Harness behavior varies by model and version. Full independent user studies and generalization claims are beyond the recorded evidence.

## Publication evidence

Native CI is the publication gate: each advertised archive must build, run its applicable tests, and pass isolated archive installation on its own OS/architecture. The public [Actions runs](https://github.com/funsaized/ribbit/actions) and [release assets](https://github.com/funsaized/ribbit/releases/tag/v0.1.0-alpha.1) identify the published revision and checksums. The current local evaluations retain their actual binary hashes; they do not claim a live model run on every release platform.
