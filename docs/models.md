# Model evidence and route selection

The **2026-10-03 baseline** uses fresh local inference against the current uncommitted working tree, not the published release revision. The [manifest](../evals/results/baseline.json) pins the reports and replays. All runs share one binary/source/lock hash; the Git revision identifies the base commit and `worktreeDirty` is true.

The installed models are Qwen2.5 0.5B Q4_K_M (`ribbit-baseline-small`, 4096 loaded context) and Gemma 4 E4B Q4_K_M (`ribbit-baseline-gemma`, 8192 loaded context), served by local LM Studio on a Linux x64/RTX 3080 Ti workstation. No model was downloaded. [Environment evidence](../evals/results/baseline-environment.json) records text-weight digests, loaded model settings, hardware, and available runtime metadata.

Command runs request temperature 0, reasoning off, at most 2048 output tokens, 30-second requests, 90-second command budgets, and three repetitions. Provider/template thinking controls are not a guarantee that internal generation is disabled. Workflow reasoning and Codex sampling use defaults, so their timings are not an identical-settings benchmark against command runs. Unknown token usage is not zero.

## Per-command results

**P/F/R means pass / fail / review required**, counted across repetitions and modes. Pending review is not a pass. No source-review file was applied; other than exact authored references, prose facts and citations remain unreviewed.

| Semantic command | Gemma P/F/R | 0.5B P/F/R |
| --- | --- | --- |
| ask | 6/0/0 | 3/0/3 |
| classify | 3/0/0 | 0/3/0 |
| compare | 0/0/3 | 0/0/3 |
| explain | 0/0/3 | 0/0/3 |
| extract | 3/0/0 | 3/0/0 |
| filter | 3/0/0 | 0/3/0 |
| find | 3/0/0 | 2/1/0 |
| group | 3/0/0 | 0/3/0 |
| map | 3/0/3 | 3/0/3 |
| pick | 3/0/0 | 3/0/0 |
| rank | 3/0/0 | 3/0/0 |
| reduce | 0/0/6 | 0/0/6 |
| rewrite | 0/0/3 | 0/0/3 |
| summarize | 0/0/3 | 0/0/3 |
| tree | 3/1/2 | 3/0/3 |

Raw reports: [Gemma](../evals/results/release/2026-10-03T17-30-00-842Z-ribbit-baseline-gemma/report.json) and [0.5B](../evals/results/release/2026-10-03T17-33-45-898Z-ribbit-baseline-small/report.json). [Individual acceptance](release-acceptance.md) separates packaged contracts from these live results.

Gemma has 33 passes, one failure, and 23 pending attempts. The failure is a `tree-describe` reply whose IDs did not match the candidates; the CLI rejected it with exit 4. The 0.5B run has 20 passes, ten failures, and 27 pending attempts. All its classification, filtering, and grouping repetitions failed, as did one semantic file-selection attempt. Passing extraction or ranking on these fixtures does not establish suitability for arbitrary inputs. Neither model has full factual acceptance.

## End-to-end comparison

The [workflow report](../evals/results/workflows/2026-10-03T17-34-01-189Z/report.json) records triage, context, and brief jobs on local-only, direct-stronger, and mixed routes, three times each. All 27 attempts passed their shape, stage-exit, and applicable evidence-retention checks. Their final prose remains `review_required`, not accepted.

| Recipe | Route | P/F/R | Mean wall time (ms) | Mean final evidence bytes |
| --- | --- | --- | --- | --- |
| triage | local-only | 0/0/3 | 1164 | 638 |
| triage | direct-stronger | 0/0/3 | 9115 | 545 |
| triage | mixed | 0/0/3 | 13107 | 638 |
| context | local-only | 0/0/3 | 781 | 816 |
| context | direct-stronger | 0/0/3 | 8622 | 760 |
| context | mixed | 0/0/3 | 7790 | 816 |
| brief | local-only | 0/0/3 | 266 | 75 |
| brief | direct-stronger | 0/0/3 | 3060 | 90 |
| brief | mixed | 0/0/3 | 3780 | 75 |

These are observations on tiny public fixtures and an uncontrolled shared workstation. Wall time includes CLI overhead; cache state and other load were not controlled. Downstream bytes measure evidence at the final model boundary, not tokens. Token usage is unknown in these CLI runs, and monetary cost is unmeasured.

The annotation recipes retain originals and add input bytes. The brief compresses text and can lose facts that rewriting cannot recover. Without source-grounded review, these measurements establish no quality-adjusted speed, cost, or context-saving advantage. A direct stronger-model call is often simpler when the intermediate annotation has no separate use.

## Harness boundary

The [local Codex report](../evals/results/handoff/2026-10-03T17-36-24-439Z/report.json) and [context records](../evals/results/handoff/2026-10-03T17-36-24-439Z/context.records) capture one read-only stdin interpretation task with Codex 0.160.0 and Gemma. Codex returned an answer with exit zero; the layered rubric reports **review required**, not factual acceptance. It also emitted fallback-model-metadata and temporary-home-helper warnings, which remain in the raw evidence.

This checks the real harness boundary, not autonomous coding or tool-use reliability. The runner uses an isolated CODEX_HOME, ignores user configuration, selects the local provider explicitly, and does not use cloud credentials.

## Limits and reproduction

These fixtures are public, authored, small, and not held out. Structured fixture results and exact authored references are deterministic checks; arbitrary prose needs output-bound source/citation review and independent human judgment. A passing JSON shape cannot establish factual correctness.

The [evaluation guide](../evals/README.md) links all raw reports and offline replays and documents review bindings. `bun run eval:release -- --help` lists per-command selection; smoke runs once and full runs three repetitions. Exact CLI behavior is checked separately by native tests. Model routes remain task-specific and experimental.
