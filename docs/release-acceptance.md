# Individual release acceptance

Contract and packaged-CLI checks are separate from live semantic correctness. The live columns use the **2026-10-03 current-state baseline**, with rubric 2.0.0 and **P/F/R = pass / fail / review required**. Pending review is not a pass, and no source-review file was applied to this baseline. Both command runs have failures; arbitrary prose remains unreviewed. These small public samples do not certify broad model quality or the published release revision. See the [release checklist](release-checklist.md).

Run `bun run build && bun run test:release`. The [catalog](../scripts/release/cases.ts) supplies exact arguments, inputs, mock replies, and assertions; [command examples](command-examples.md) render them. `pick` uses real fzf on a controlling PTY. The [failure suite](../tests/release/commands.test.ts) and filesystem/record/budget suites cover additional invariants.

| Command | Case IDs / modes | Contract + packaged CLI | Gemma live P/F/R | 0.5B live P/F/R | Verdict |
| --- | --- | --- | --- | --- | --- |
| ask | ask-grounded, ask-injection | PASS | 6/0/0 | 3/0/3 | Contract accepted; semantic use experimental and profile-specific |
| classify | classify-preserve | PASS | 3/0/0 | 0/3/0 | Contract accepted; semantic use experimental and profile-specific |
| compare | compare-sources | PASS | 0/0/3 | 0/0/3 | Contract accepted; semantic use experimental and profile-specific |
| explain | explain-audience | PASS | 0/0/3 | 0/0/3 | Contract accepted; semantic use experimental and profile-specific |
| extract | extract-missing | PASS | 3/0/0 | 3/0/0 | Contract accepted; semantic use experimental and profile-specific |
| filter | filter-recall | PASS | 3/0/0 | 0/3/0 | Contract accepted; semantic use experimental and profile-specific |
| find | find-exact, find-semantic | PASS | 3/0/0 | 2/1/0 | Contract accepted; semantic use experimental and profile-specific |
| group | group-partition | PASS | 3/0/0 | 0/3/0 | Contract accepted; semantic use experimental and profile-specific |
| ls | ls-metadata | PASS | n/a | n/a | Deterministic behavior covered by native release CI |
| map | map-lineage, map-schema | PASS | 3/0/3 | 3/0/3 | Contract accepted; semantic use experimental and profile-specific |
| pick | exact, semantic ranking, cancellation | PASS | 3/0/0 | 3/0/0 | Contract accepted; semantic use experimental and profile-specific |
| rank | rank-permutation | PASS | 3/0/0 | 3/0/0 | Contract accepted; semantic use experimental and profile-specific |
| read | read-boundaries | PASS | n/a | n/a | Deterministic behavior covered by native release CI |
| reduce | reduce-evidence, reduce-chunked | PASS | 0/0/6 | 0/0/6 | Contract accepted; semantic use experimental and profile-specific |
| render | render-values | PASS | n/a | n/a | Deterministic behavior covered by native release CI |
| rewrite | rewrite-facts | PASS | 0/0/3 | 0/0/3 | Contract accepted; semantic use experimental and profile-specific |
| select | select-fields | PASS | n/a | n/a | Deterministic behavior covered by native release CI |
| sort | sort-numeric | PASS | n/a | n/a | Deterministic behavior covered by native release CI |
| summarize | summarize-facts | PASS | 0/0/3 | 0/0/3 | Contract accepted; semantic use experimental and profile-specific |
| take | take-prefix | PASS | n/a | n/a | Deterministic behavior covered by native release CI |
| tree | tree-exact, tree-about, tree-describe | PASS | 3/1/2 | 3/0/3 | Contract accepted; semantic use experimental and profile-specific |
| unique | unique-key | PASS | n/a | n/a | Deterministic behavior covered by native release CI |
| where | squirrel-report flow | PASS | n/a | n/a | Typed equality and preservation covered by [packaged flow](../tests/release/squirrels.test.ts) and [unit contracts](../tests/builtins/commands.test.ts); not a legacy case-catalog evaluation |

Raw evidence: [Gemma](../evals/results/release/2026-10-03T17-30-00-842Z-ribbit-baseline-gemma/report.json), [0.5B](../evals/results/release/2026-10-03T17-33-45-898Z-ribbit-baseline-small/report.json), and the [baseline manifest](../evals/results/baseline.json). Counts aggregate modes only for display; every required criterion must pass every repetition. Failed or pending modes are never waived by other passes. The [evaluation guide](../evals/README.md) links the hash-bound offline replays and explains source review.

## Management surfaces

Evidence: [packaged lifecycle tests](../tests/release/management.test.ts), [concrete inspection tests](../tests/release/inspection.test.ts), [picker readiness tests](../tests/release/doctor-picker.test.ts), [recipe tests](../tests/release/recipes.test.ts), and existing CLI/extension tests.

| Surface | Checked behavior | Verdict |
| --- | --- | --- |
| setup | Discovery returns versioned data, performs no download or config mutation | PASS in packaged tests |
| doctor | Scoped/default route readiness, declared capabilities, authentication, fzf version, extension health, explicit model-list probes | PASS in packaged tests |
| providers | Add/list/remove and referenced-provider rejection | PASS in packaged tests |
| models | Explicit provider discovery against mock HTTP | PASS in packaged tests |
| profiles | Set/show/list/remove and route selection | PASS in packaged tests |
| route | Concrete parsed arguments/defaults/overrides, execution-matched route provenance and exact no-inference inspection | PASS in packaged tests |
| commands | List/describe every built-in; validate named definition | PASS in packaged tests |
| types | List and scoped contract description | PASS in packaged tests |
| extensions | Scaffold/check/test/add/list/remove; source preserved | PASS in packaged tests |
| run | Named defaults and invocation override | PASS in packaged tests |
| flow | Validate/plan/run; saved/inline/OS-pipe equivalence; routing and budget failure | PASS in packaged tests |
| init | Idempotent project/guidance initialization preserves owner text | PASS in packaged tests |
| completions | bash/zsh/fish include named definitions | PASS in packaged tests |

These are bounded acceptance cases, not exhaustive subcommand fuzzing. Real remote-provider conformance, independent user onboarding, and Windows interactive console behavior remain separate checks.
