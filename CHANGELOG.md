# Changelog

## Unreleased

These changes are unreleased; the latest published preview remains `0.1.0-alpha.2`.

- Preserve supported external JSON Schema constraints and defaults through provider requests and runtime validation.
- Generate CLI help from command contracts, resolve inference capabilities from invocation arguments, and inspect concrete invocations with `route inspect -- COMMAND …` and scoped `doctor`. Conditional extension declarations replace `inferenceWhen`; rebuild affected extensions explicitly. Legacy registrations remain removable.
- Add bounded offline fixture diagnostics and checkout-only `eval:report` rendering of saved evaluation/fixture reports. Rendering does not execute commands, regrade results, or establish acceptance.
- Pin evaluation provenance and add layered, versioned offline regrading. Recorded verdicts remain distinct from factual acceptance; unreviewed prose stays `review_required`.
- Isolate independent CI test contracts and exclude Python `__pycache__` directories from native archives without removing source, fixtures or evaluation evidence.

## 0.1.0-alpha.2 — 2026-09-24

- Added envelope field addressing, explicit projection aliases, typed `where`, and evidence-preserving named annotations without changing record wire format v1.
- Excluded sensitive-looking names during content discovery; retained explicit-path access and opt-in.
- Added a read-only GitHub PR evidence extension with offline replay, plus pinned failing-CI, date-fns, and Squirrel Census examples.
- Updated the framework introduction and record/runtime/trust documentation. Both registry installers use checksum-pinned native GitHub release assets; GitHub Packages is a separate mirror.

Model outputs remain variable; typed contracts validate structure, not factual correctness. See the [verified native CI matrix](https://github.com/funsaized/ribbit/actions) for the release commit, not earlier previews.

## 0.1.0-alpha.1 — 2026-09-20

- Clarified the product around composable commands, original evidence, explicit model routes, and harness handoffs.
- Added individual packaged acceptance tests for all 22 commands, optional semantic modes, management lifecycle, and real fzf selection/cancellation.
- Added equivalent shell/inline/saved-flow checks and three runnable recipes.
- Added per-command opt-in live regression evaluation with raw provider attempts, binary/fixture provenance, and explicit model budgets.
- Updated AJV to 8.18.0 and YAML to 2.8.3 to resolve the production dependency advisories reported by npm audit.
- Fixed compare to enforce a shared invocation byte budget across both input files before inference.
- Added contributor and installation guidance, release packaging/checksums, and deterministic CI configuration.

Semantic results are experimental and model-dependent. This is not a 1.0 API stability promise. MIT-licensed experimental preview with native Linux/macOS/Windows build and test jobs on x64 and ARM64. Independent quality review and onboarding pilots remain follow-up work.

- Added portable executable naming, Windows console access, normalized relative paths, file-URL extension imports, native CI, and macOS ad-hoc signing.
