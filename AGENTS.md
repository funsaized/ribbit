# Working on Ribbit with Pi

Ribbit composes exact and model-backed commands through typed contracts and inspectable records. Keep changes bounded and evidence visible.

## Orient

Start with `git status --short --branch`, `git diff`, and `git log -5 --oneline`. Preserve existing edits and commits. Read [CONTRIBUTING.md](CONTRIBUTING.md), [development instructions](docs/development.md), and the relevant reference/tests. For scope changes, read [product direction](docs/product-direction.md).

Use the tools available in this Pi session: `read` for source, `bash` for searches/reproduction/checks, and `edit`/`write` for changes. Prefer `rg` and `rg --files`; include hidden paths when checking configuration. Read relevant discovered `SKILL.md` files and project `.pi` configuration if present. Browser, LSP, web tools, and subagents depend on installed extensions; do not assume them.

## Investigate before changing behavior

- Reproduce a defect with the smallest sanitized input. Record the command, expected result, actual stdout/stderr, and exit status. Trace the contract, implementation, and nearest regression tests before editing. Distinguish malformed model output from a valid but wrong answer.
- For current external APIs or uncertain protocol behavior, use available web tools, including pi-web-access if loaded, to consult official documentation or upstream source. Record the source and applicable version; if access is unavailable, state the uncertainty.
- For a substantial backlog item, first present reproduction/findings, a bounded plan, affected contracts, and validation design. Wait for implementation approval unless already given. Small, clearly authorized fixes do not need a separate plan. Complete and review one bounded item with the user before starting the next.
- Implement the smallest coherent change. Add a regression that exposes the behavior failure rather than restating the implementation. Follow nearby TypeScript conventions and the checked-in formatter/linter configuration.

## Find the right boundary

- `src/sdk` defines public contracts; `src/sdk/manifest` exports schemas and CLI bindings. `src/build/schema` handles JSON Schema validation.
- `src/cli` owns parsing, help, management, and shell I/O; `src/builtins` implements commands.
- `src/engine` owns record admission, execution budgets, runtime dispatch, and managed inference; `src/providers`, `src/config`, and `src/routing` own transport and route selection.
- `src/catalog` and `src/extensions` separate manifest discovery from trusted code execution. `src/definitions` and `src/flows` compose commands; `src/filesystem` owns traversal.
- `tests` mirrors these areas. `tests/release` exercises the built executable; `scripts/release`, `fixtures`, and `evals` hold acceptance/evaluation machinery. Consult `docs/reference` for user contracts.

## Choose verification

Use the Bun version pinned in `package.json` and CI (currently 1.4.0). The full gate also needs Node.js/npm, Python 3, and fzf; follow the minimum versions in `CONTRIBUTING.md` (currently Node.js >=20 and fzf >=0.74.3). Unix picker checks need a controlling PTY.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
```

Run the relevant file or directory first with `bun test`. Useful focused checks:

| Changed contract | Command |
| --- | --- |
| Help/parsing | `bun test tests/cli/help.test.ts tests/cli/parser.test.ts` |
| Dormant discovery | `bun test tests/extensions/discovery.test.ts` |
| Schema fidelity | `bun test tests/builtins/schema-parity.test.ts tests/providers/managed.test.ts` |
| Evaluation grading/provenance | `bun test tests/evals` |
| Packaged schema behavior, after building | `bun test tests/release/schema-parity.test.ts` |

Before code review, run `bun run verify`: frozen install, type/lint/format checks, deterministic suites, build, installed smoke, release tests, and Markdown links. These use fixtures and loopback mocks without model credentials. For documentation-only edits, run `bun run test:docs`; for site changes also run `mkdocs build --strict` using the environment described in `docs/development.md`. Distribution changes additionally need `bun run package:release` and `bun run package:verify`. Report missing prerequisites and failed or unrun checks explicitly.

## Preserve the contracts

- Keep stdout as data and diagnostics/stats on stderr. Preserve documented exit codes, record identity/source/annotations, finite budgets, cancellation, and bounded repair/retry. Check pipeline exit status with `pipefail` where supported; partial stdout is not a complete result.
- Resolve providers/models explicitly through configured routes. Never silently switch providers, escalate to cloud, or download models. Exact commands make no inference requests.
- Help, catalog discovery, completions, route inspection, and flow planning must remain offline and avoid importing installed extension code. Extension check/test/add executes trusted code. `setup`, `models list`, and `doctor --probe` contact endpoints: use them only when live access is authorized. Live evaluations require explicit opt-in and `RIBBIT_RUN_LIVE_EVAL=1`; follow [evals/README.md](evals/README.md).
- Preserve all supported schema constraints/defaults across export, help, parsing, provider requests, and runtime validation. Reject unsupported schemas before transport; do not weaken them to accept an answer.
- Regenerate `src/generated` with `bun run build`; never hand-edit it. Inspect generated diffs and include only changes justified by the source edit. Keep ignored build/package outputs out of commits.
- Keep synthetic fixtures labeled as synthetic. New evaluation evidence belongs in timestamped directories with provenance/hashes and failures retained; regrading writes separate outputs. Do not tune fixtures or gates to observed answers. Valid JSON, exit zero, or keyword matches do not establish factual correctness; `review_required` is not a pass, and AI review is not human review.

## Finish the item

Run `git diff --check`, inspect the complete diff and status, and report the changed behavior, verification evidence, and remaining limitations. Stage only intended paths. Commit/push only within the user's authorization, preserving the target branch and all unrelated work; do not reset, amend, or force-push without explicit instruction. Merging, tagging, releasing, and package publication require explicit authorization.
