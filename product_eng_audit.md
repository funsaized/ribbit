# Ribbit product and engineering audit

Ribbit already has a coherent semantic record engine: typed command contracts, preserved record identity, explicit model routes, bounded execution, reusable YAML commands and flows, and a usable extension SDK. Its best next work is to make those properties easy to see and verify in one useful task. The immediate blockers are weaker evaluation verdicts than the outputs warrant, a reproduced extraction schema defect, and CLI discovery that does not explain the actual invocation contract.

This report supports planning and parent orchestration. It proposes changes; it does not implement them. No tracked source, settings, remote repository, published artifact, or model provider was changed. No live inference or paid provider was called. The parent separately owns the live visual site and market comparison.

## Scope and evidence

Audit date: 3 October 2026. Repository: https://github.com/funsaized/ribbit. Separate checkout: `/workspace/ribbit-audit/repo`; mounted Vellum and other projects were not modified. Audited main HEAD: **be6e7ed90e6a5f8c4a032520ec724ef417cf784a**, `chore: docs`, committed 24 September 2026. Product package version: **0.1.0-alpha.2**. All source links below pin that HEAD.

Evidence labels are local to the claim: **Implemented** means read in current source; **Tested** means reproduced here with offline fixtures or loopback mocks; **Historical output** means read from saved September evaluation artifacts, not regenerated; **Inference** means an audit interpretation; **Proposal** means future work. Passing a contract test or a shape validator does not establish factual correctness.

There are 316 tracked files. All 209 non-generated project and fixture files were read in full, including 31 handwritten `src` modules and all 38 test files. Seven of those files are copied upstream date-fns source/guidance/license excerpts, not Ribbit implementation. Eleven generated files were reviewed as generated artifacts: catalog and validator generation, frozen dependency resolution, saved evaluation metadata, every saved final command/workflow output, and original-to-derived report differences. Repetitive raw SSE bodies were parsed as JSON data and sampled rather than read line by line. The 96 third-party license notices were inventoried and hashed; their complete legal text was not manually audited. The per-file inventory at the end records these distinctions. There is no root AGENTS.md or repository .agents/skills directory; the only AGENTS.md is the pinned date-fns fixture and was read as fixture evidence.

**Tested:** `bun install --frozen-lockfile --ignore-scripts`, then documented `bun run verify` passed: 115 unit, 11 CLI, 1 consumer, 2 conformance, and 40 packaged release tests, **169 tests with zero failures**. Type checking, lint, format checks, build, installed CLI/extension authoring smoke, and documentation link checks passed. `package:release`, `package:verify`, and `package:npm:verify` passed local archive/npm installation checks, including mocked download checksum failure and retry behavior. `mkdocs build --strict` passed into an audit-only output directory. The real fzf/PTY packaged tests ran on Linux. Mac/Windows native execution and real remote providers were not tested here.

Toolchain: Bun 1.4.0, Node 24.19.0, fzf 0.74.3. Frozen lock SHA-256: `0b5303f2ba32b98a15f53e57bb603a8f16e97f3655f52a6e6172141e50a08d00`. Built Linux binary SHA-256: `42ff76c7e7f54d77a4f90543f185e4c4e63792e690365755fce98a8d02d46518`. Final tracked working tree is clean; build outputs and dependencies occupy ignored directories.

**Verified public distribution:** npm `latest` and `alpha` both resolve to 0.1.0-alpha.2. The public six-file npm wrapper was fetched and inspected without running its install script. Its Linux binary checksum equals the binary built in this audit. Its recorded release revision is `242ebfee4ed6c14926eda3e600e6f1ebb535abc7`; Git diff from that revision to HEAD contains only README.md and docs/index.md changes. The six native assets exist in the published prerelease. The public archive itself was not downloaded or installed. Sources: [published release](https://github.com/funsaized/ribbit/releases/tag/v0.1.0-alpha.2), [npm package](https://www.npmjs.com/package/@funsaized/ribbit).

The saved model runs use older revision `04dee0807e0d1733e0ac376ef7a22f8a56af17af` and binary SHA-256 `e0a245762166bc4f8a6d23c779c2b73e1a6bf2dc0394ff0cca37458db16612da`. They are useful historical evidence, not a new semantic acceptance run for alpha.2. This distinction is already disclosed in [the evaluation guide](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/evals/README.md#L5).

## Current feature architecture

| Layer | Implemented behavior | Important boundary |
| --- | --- | --- |
| SDK | TypeScript `defineCommand`/`defineAction`, Zod config/args/input/output, value/record/text stream modes, declared capabilities/effects, runtime validation and cancellation | Supported Zod subset; effects describe trusted code rather than restrict it. [SDK](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/sdk/index.ts#L57), [manifest conversion](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/sdk/manifest/index.ts#L6) |
| Catalog and build | 23 standard commands, deterministic manifests, generated AJV validators, Bun native executable and adjacent SDK/compiler library | Product alpha version and built-in type version 1.0.0 are different concepts. [catalog](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/builtins/index.ts#L1), [build](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/build.ts#L1) |
| Records | Versioned wire header and envelopes with `id`, `value`, optional source path/line range, annotations; strict finite JSON, duplicate ID rejection, UTF-8 checks | IDs are record identity, not guaranteed global/domain identity. Bare JSONL deliberately exports values only. [record schema](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/records/index.ts#L40), [adapters](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/records/index.ts#L203), [serialization](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/records/index.ts#L256) |
| Exact operations | where, select, sort, unique, take, render; exact filesystem modes | Preserve metadata through transforms; global sort/unique materialize candidates; exact mode is convenient at record boundaries, not proof that ordinary jq/sort cannot do the task. [exact operations](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/builtins/exact.ts#L1) |
| Semantic operations | ask, summarize, explain, rewrite, extract, classify, filter, map, rank, group, reduce, compare | Text operations trust model prose; schema validates shape, labels constrain vocabulary, rank/group validate real IDs and complete permutation/partition rather than semantic judgments. [semantic commands](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/builtins/semantic.ts#L1) |
| Filesystem and picker | Bounded traversal/ignore handling, metadata/name/content modes, source-bearing read records, semantic real-ID selection, fzf selection on controlling terminal | Traversal is materialized; content exclusion uses names/ignore rules rather than secret scanning. Explicit read is a deliberate boundary. Picker needs external fzf. [filesystem](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/filesystem/index.ts#L1), [picker](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/builtins/filesystem.ts#L250) |
| Routing/providers | Ollama and OpenAI-compatible adapters, explicit profiles/provider/model overrides, capability/context admission, no automatic fallback | Managed provider protocol is narrower than all models bearing an OpenAI-compatible label. Model capabilities/context sizes are configured declarations, not automatic quality discovery. [provider contract](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/providers/interface/index.ts#L1), [precedence](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/routing/index.ts#L4) |
| Runtime | Shared requests/tokens/bytes/record/time budgets, request serialization, SIGINT/cancellation, one bounded retry and structured repair, stderr statistics | Text inference buffers the response before returning; streamed transport does not mean user sees streamed built-in text. Flow budgets count outputs cumulatively. [inference](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/inference/index.ts#L37), [budgets](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/execution/index.ts#L12), [output accounting](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/runtime/index.ts#L161) |
| Reuse and flows | Current-directory/global YAML named commands with exact type versions; saved or inline flow plan/validate/run, backward references, stream/materialize boundaries, explicit per-step routes | Ordered execution, not parallel DAG orchestration. Fanout/reference reuse materializes outputs; general semantic equivalence between step schemas is not proved. [definitions](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/definitions/index.ts#L1), [flows](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/flows/index.ts#L1), [plan output](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/flows/cli.ts#L93) |
| Extensions | Scaffold, compile/check, fixture test, add/list/remove; hashed installed artifacts and source freshness; dormant manifest discovery | Check/test/add execute reviewed code. Source must remain available and unchanged; effects are not a sandbox. [check](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/extensions/build/index.ts#L17), [freshness](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/extensions/install/index.ts#L120), [fixture tests](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/scaffold/index.ts#L49) |
| Evaluation | Internal opt-in loopback scripts; authored cases, raw command HTTP capture, workflow stage capture, local Codex handoff sample | There is no built-in end-user `ribbit eval` command, arbitrary dataset API, eval dashboard, grader registry, or report renderer. [scripts](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/package.json#L32), [runner interface](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/evaluate.ts#L17) |

Route precedence is global → project → saved flow → invocation flow → per-command → definition → step → CLI, with explicit flow force-profile above those. Changing provider resets the inherited model to that provider's default instead of keeping an unrelated model. Missing/unsupported routes fail. This is a real and well-tested part of the historical no-automatic-cloud-fallback intent. [routing layers](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/routing/index.ts#L4), [provider reset](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/routing/index.ts#L53), [route tests](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/tests/routing/resolver.test.ts#L1).

## Findings ordered by priority

P1 means address before stronger correctness or reliability claims and before expanding the affected product surface. P2 means substantial usability/observability limitation. P3 means polish or a bounded coverage gap. These are audit priorities, not claims of exploitable security vulnerabilities.

### F01 Evaluation passes materially wrong answers

**P1. Historical output plus offline tests.** The saved workflow report records 27/27 passes. Local-only triage incorrectly says R2's spelling mistake blocks purchases in repetitions 1 and 3; repetition 2 invents a spelling mistake for R1 and calls all tickets blocking. All three local-only context outputs reverse `sessionIsValid`: they say it returns true for an expired session even while repeating `expiresAt > now`. All three local-only and mixed brief outputs shift the deadline from **by Friday** to **on Friday**. These are specific factual defects, not malformed JSON.

The cause is visible in the grader: triage tests presence of IDs plus an accessibility word; context tests filenames/identifier words, not operator meaning; brief tests Mina/Friday/240 only. Context's prompt even supplies the expected identifiers and comparison, making term presence less informative. `falseNegativesFromSelection` is assigned zero for non-brief recipes; neither triage nor context semantically filters, so it is not a measured general recall score. Triage retention compares serialized projected values to input strings; context retention checks path equality and nonempty content, not fixture-byte equality. [triage floor](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/workflows.ts#L109), [context floor](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/workflows.ts#L143), [brief floor](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/workflows.ts#L187), [selection field](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/workflows.ts#L204).

The stronger model's three `reduce-chunked` answers all lose the relationship **Jo owns 7 tasks**, retaining fragments `Jo ow` and `ns 7 tasks` instead. All pass because the checker only requires Mina, 24, Jo, and 7 somewhere. The current chunker splits by UTF-8 byte size without sentence or record boundaries; the 25-byte fixture splits Jo's statement. [chunked case](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/cases.ts#L227), [chunking](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/builtins/semantic.ts#L368).

All three small-model `explain-audience` answers claim the 12 MB file exceeds an allowed size of 12 MB but does not reach an 8 MB maximum. They pass. Small-model summary and rewrite outputs also change by Friday to on Friday. Small-model reduce repetitions 1 and 3 omit explicit record ID citations, yet pass because single letters a/b count as evidence. [substring checker](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/cases.ts#L45), [explanation floor](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/cases.ts#L95), [citation floor](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/cases.ts#L225).

**Tested:** replaying saved stdout through the current case checkers preserves their saved accepted/rejected output verdicts. Six deliberately contradictory synthetic outputs also pass the current checks, including “The upload succeeded because 12 MB is smaller than the 8 MB limit; a file was saved” and a reversed compare change. Synthetic counterexamples demonstrate grader weakness; they are not new model transcripts. Representative outputs and the exact accepted counterexamples appear below.

**Inference:** the existing warnings correctly call these public regression floors rather than broad quality certification. Nevertheless, a PASS column can be read as task success, and [the brief explanation](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/docs/explanation/recipes.md#L35) incorrectly says the fixture checks an unassigned reviewer when the live workflow grader does not. Reporting needs distinct shape/invariant/fact/citation/review verdicts and rubric versioning. Preserve historical raw results; create a new derived regrade record and explain changed criteria instead of silently rewriting prior passes.

### F02 Extraction drops sibling schema constraints

**P1. Implemented and tested.** `schemaToZod` returns immediately for `const`, `enum`, and `anyOf`, bypassing sibling type/length/numeric constraints and defaults. With `{type:"string", enum:["x"], minLength:10}`, AJV rejects `"x"` while the converted Zod schema accepts it. The packaged `extract` command accepts a mock provider answer `"x"` with exit zero and no repair. This violates the supplied extraction contract. [early returns](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/build/schema/index.ts#L105), [extraction path](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/builtins/semantic.ts#L123).

**Proposal:** establish one authoritative validation interpretation. Either preserve all supported sibling constraints through conversion or reject combinations that cannot be preserved before inference. Add parity regressions for enum/const/anyOf with sibling bounds/type/defaults, nested schemas, nullable types, and invalid provider replies. Keep finite JSON and the deliberately narrow schema subset. A successful schema conversion must mean the runtime actually enforces the supplied supported constraints.

### F03 Help makes valid command discovery unnecessarily difficult

**P2. Tested.** `ribbit providers add --help` returns the generic top-level command list; it supplies no provider subcommand syntax. Built-in help omits allowed enum values, required/default semantics, examples, and budget flags. It prints `Defaults: {}` even when arguments have schema defaults. Most concretely, `where --help` advertises `--equals <json>` but `where ok --equals true --input jsonl` exits 2 with “Complex arguments require --args-json”. The correct typed invocation exists in reference docs, not in help. [built-in help](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/cli/main.ts#L37), [management help path](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/cli/main.ts#L58), [parser](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/cli/parser/index.ts#L1).

**Proposal:** generate help from the real parser contract, including `--args-json` examples for complex/union arguments, enum choices/defaults/required fields, and per-management-subcommand syntax. Acceptance: every advertised example parses and runs against a safe fixture; help/describe/completions remain dormant and offline, as [existing discovery tests](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/tests/extensions/discovery.test.ts#L7) require.

### F04 Route inspection cannot inspect conditional inference

**P2. Tested.** `route inspect find --json` returns `inference:false`; adding `--about session expiration` is rejected as an unknown management flag. The actual `find repository --about ... --read content --stats` makes a model request. Similar gaps apply to `tree --describe/--about` and `pick --about`. This matters because users rely on route inspection to understand which data leaves an exact operation. Saved flow plan can inspect a fully specified step today. [route inspect](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/cli/admin/index.ts#L305), [management parser](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/cli/admin/index.ts#L82), [conditional inference](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/runtime/index.ts#L29).

**Proposal:** let route inspection accept a concrete command/action argument segment using the same parser as execution. Report evidence mode, capability requirements, provider/endpoint/model, override provenance, and zero-request plan status without importing extension code or contacting a provider. Do not add automatic cloud fallback.

### F05 Output preserves identity but lacks sufficient interpretation provenance

**P2. Implemented and tested.** Classification requests a short reason and label but emits only `annotations.classify.label`. Existing annotations/source/value are preserved, but there is no record-level model/profile/prompt/version reference. Repeating classify overwrites its previous annotation. Global `--stats` routes contain provider/model/override source, with no step ID or request-to-record relationship. The fields help debug routing but cannot attribute a bad label or model output to a specific step in a multi-stage flow. [reason and output](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/builtins/semantic.ts#L169), [route stats](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/runtime/index.ts#L75), [flow stats](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/flows/cli.ts#L129).

`--output jsonl` and `render --as jsonl` intentionally remove ID/source/annotations. This is documented and tested, but an easy premature export loses the very labels the workflow produced. Annotation projection is already implemented; examples should show `select 'label=$.annotations.classify.label'` before export when downstream tools need it. [export](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/records/index.ts#L256), [annotation projection](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/docs/command-examples.md#L43).

**Proposal:** add a compact optional execution trace with run/step/request/record references, settings and artifact hashes, and a short user-visible reason or supporting quote where useful. Keep original evidence separate from derived annotations and label reasons as model assertions. Preserve stdout as composable data; put the detailed trace in an explicit sidecar/export. Decide overwrite/history behavior deliberately rather than accumulating annotations without bounds.

### F06 Fixture failures and evaluation reports need actionable result structure

**P2. Tested and implemented.** A scaffold fixture with `expected:"WRONG"` fails with exit 5, but the entire result is only `{file:"wrong.json",pass:false}`. It contains no expected/actual value, mismatch path, or diff. [fixture comparison](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/scaffold/index.ts#L107).

Command evaluation reports contain useful stdout/stderr, raw HTTP, timings, and retries/repairs. Their main verdict is a boolean plus a free-text first assertion failure; case expectations are executable closures in source. There are no machine-readable criteria, per-criterion results, completion state, failure category, artifact references for large transport data, or native human-readable summary. `firstPassCorrect` combines floor correctness with zero repairs and does not separately express retry status. Fixture SHA covers cases.ts, not all external schema/filesystem/picker files. Workflow reports have still less provenance: script and binary hashes but no git revision, complete fixture hashes, model digests, environment/settings record, or raw provider exchange. [Case interface](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/cases.ts#L3), [report metadata](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/evaluate.ts#L129), [first-pass field](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/evaluate.ts#L223), [workflow metadata](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/workflows.ts#L30).

**Proposal:** start with an offline renderer/exporter for existing reports and a versioned richer result schema. Do not infer an already-shipped user eval product. An exec-provider/export integration with an existing evaluator is a plausible seam for the parent to compare before building a broad eval engine.

### F07 Doctor reports configuration health rather than first-task readiness

**P2. Tested.** An empty configuration plus installed fzf yields doctor `ok:true`, while `route inspect ask` immediately fails “No complete route”. Doctor checks picker presence rather than the >=0.74.3 version required by pick. Optional probe lists models; it does not establish that the selected default/profile is complete, loaded, compatible, or semantically adequate. Setup discovers local endpoints without installing models or saving configuration, correctly and explicitly. [setup](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/cli/admin/index.ts#L325), [doctor](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/cli/admin/index.ts#L357), [picker version gate](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/builtins/filesystem.ts#L288).

**Proposal:** keep health checks factual and name them precisely. Show separate statuses for exact-command readiness, picker readiness, route readiness, and explicitly probed provider/model availability, with copyable next commands. No automatic download, configuration mutation, or fallback is needed. Management boolean parsing also treats `--probe=false` as true; [the option parser](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/cli/admin/index.ts#L30) deserves a regression and literal boolean handling before expanding diagnostics.

### F08 Mode specific provider capabilities are overconstrained

**P2. Tested.** map declares both text and object capabilities unconditionally. An object-only mock route successfully executes extract with the same schema but rejects `map --schema` before making a request: “Provider does not support text”. A text-only route similarly cannot use a text-only map. [capabilities](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/builtins/semantic.ts#L258), [inference requirement](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/runtime/index.ts#L29).

**Proposal:** derive requirements from the actual mode while preserving preflight failures for genuinely unsupported requests. This is a routing/manifest/runtime change, not just a message edit. Tests should prove text map, schema map, annotate map, flow plan, route inspection, and missing capability behavior agree.

### F09 Bounded and streaming behavior needs clearer task scale guidance

**P2. Implemented and tested.** Record classify/filter/map make sequential requests, typically one per record. Default maxRequests is 32; repairs/retries consume it. Rank/group collect at most 200 candidates. Flow record/byte budgets charge stage outputs cumulatively; a two-step `take 3 :: take 3` with maxRecords 3 emits one final record and then fails 6. A malformed second input line can leave a valid first record on stdout before exit 2. All are consistent with the documented budget/prefix contract, but limits expressed simply as “records” are easy to mistake for input cardinality. [limits](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/execution/index.ts#L12), [charging](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/runtime/index.ts#L161), [per-record inference](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/builtins/semantic.ts#L171), [flow and pipe contract](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/docs/reference/runtime.md#L19).

Text inference collects all transport text before returning, and filesystem traversal collects bounded rows. Thus incremental record output, bounded memory, provider SSE support, and time-to-first-visible-text are different claims. The repository benchmark covers only startup/help/version and a tiny take, not large RSS, inference throughput, or cost. [response buffering](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/engine/inference/index.ts#L37), [traversal](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/src/filesystem/index.ts#L1), [unverified performance](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/bench.ts#L45).

**Proposal:** document per-record request estimates and cumulative budget units; report admission/candidate/output counts per step. Use existing pipefail guidance prominently where captures become saved evidence. Make any future streaming or concurrency work a separately measured project rather than a wording-only promise.

### F10 Packaging and examples are credible but require a clearer installation journey

**P2 for onboarding, P3 for metadata. Implemented/tested.** Native archives include executable/lib plus examples, fixtures, source, docs, and notices. The npm wrapper extracts executable and lib; it does not put repository example files in the working directory. Source guides mostly disclose the extra clone. The first exact tutorial and local-model tutorial are self-contained; advanced squirrel scripts require Bun/jq and a separately frozen data snapshot, and GitHub evidence requires reviewed trusted extension code plus gh. Those are legitimate advanced paths, but do not make them the npm first-run payoff. [native package](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/release/package.ts#L1), [npm install](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/npm/install.cjs#L1), [open data guide](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/docs/how-to/analyze-open-data.md#L1), [extension prerequisites](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/examples/extensions/gh-evidence/README.md#L3).

The archive is roughly 43.9 MB compressed for public Linux x64. It includes saved raw evaluation reports twice (original and derived), adding distribution weight; no package-size or installed SDK overhead benchmark is supplied. This is an opportunity to measure/simplify, not a claim that the binary is slow.

Release-checklist still names alpha.1 and links its release as authority despite current alpha.2. Source links rewritten by docs-hooks point to blob/main, so a page may lead to newer code than its recorded evaluation revision. Docs deployment path filters omit source/examples/fixtures/README changes; source-only changes can leave an example index stale until a docs-triggering commit. [release version](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/docs/release-checklist.md#L32), [source rewrite](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/scripts/docs-hooks.py#L24), [build triggers](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/.github/workflows/docs.yml#L5).

**Proposal:** give npm users one copied fixture, one explicit model configuration, one transformation, one observable validation, and one named-command reuse step. Put source-clone/dependency/trust requirements at the start of advanced guides. Link evidence to recorded revision and automate release metadata checks; decide which source/example changes should rebuild docs.

## Evaluation audit and proposed output model

The strongest honest interpretation of current evidence is: 169 offline tests support plumbing and invariants; two historical local models behave differently on a small authored task set; explicit routes and original evidence enable later review; factual success requires stronger checks than the current floor. The actual floor scores are strong 57/57 and small 39/57. Three repetitions of temperature-zero tiny fixtures are not independent generalization evidence. The historical workstation used an RTX 3080 Ti with 12 GiB, a Qwen 0.5B Q4_K_M file and Gemma E4B Q4_K_M file, LM Studio, and Bun 1.4.0. Digests are in [environment evidence](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/evals/results/release-environment.json#L1); modelDigest is null within the command reports themselves.

Original-to-derived comparisons were verified across all report fields. Only picker attempts' parsed stats, firstPassCorrect, and derivation metadata changed. No raw stdout, response, input, timing, pass, failure, or model run was replaced. Keep this precedent for a clearly versioned offline factual regrade.

| Case family | Existing useful check | Missing fact/proof check or scope limit |
| --- | --- | --- |
| ask-grounded | Exact answer Mina | One entity/tiny task; weak generalization |
| ask-injection | 240 present, BANANA absent | Arbitrary other instructions/negated or unsupported amount not excluded |
| summary/rewrite | Names/numbers/day words, summary word maximum | Owner/action relation, deadline by/on, amount polarity/unit, assigned reviewer, invented facts |
| explanation | Two number strings and two banned phrases | Which number is limit/file, comparison direction, saved/not saved, paraphrased execution claims |
| extract | Exact owner and null reviewer in one case | Larger schema coverage, citation support, external-schema parity defect |
| classify | Correct two labels and preserved envelopes | Harder ambiguity/unknown calibration, evidence support, broader label definitions |
| filter | Exact one-record expected subset | Only two originals; no general recall measurement; small model consistently selected the wrong record |
| rank | Exact permutation and expected two-record order | More candidates, ties, adversarial text, stable quality of criterion interpretation |
| group | Two singleton groups and originals retained | Group-label correctness is not checked; partition integrity does not prove semantic grouping |
| text map | Counts/IDs/source/origin retained, title keywords | Purchase polarity and original facts; lineage points to a source but does not retain original value by default |
| schema map | First returned value matches small expected object | Explicit complete output cardinality and envelope checks in this case; harder schemas |
| reduce | Keywords and letters a/b | Resolvable citations and statement-to-record support |
| chunked reduce | Four keywords | Name-number relationships and chunk-boundary evidence loss |
| compare | Source header and both numbers/name | Change direction, unchanged ownership; source header is appended by Ribbit rather than generated citation evidence |
| semantic find/tree | Selected real file identities, basic content marker | Broader relevance/recall, factual descriptions, top-level tree evidence tag says metadata for content-based selection |
| semantic pick | Selected R1 in real fzf/PTY | One selection/query and small candidate set; no general interactive study |
| workflows | Final words and simple retention floor | Per-ticket truth and order, operator meaning, deadline/reviewer facts, robust byte/identity retention |
| handoff | One local Codex answer, supplied identifiers present | Real tools/autonomous coding absent; supplied prompt states the target comparison; no independent task quality review |

**Proposal:** a version 2 evaluation result should represent `run.status` (complete/interrupted), audited revision and binary/fixture/command/flow/config hashes, case ID/version and criterion IDs, resolved per-step routes, artifacts for input/expected/actual/raw transport, per-criterion verdicts and evidence spans, failure category and safe diagnostic, requests/repairs/retries, first-call validity separately from factual correctness, elapsed time, input/output tokens with explicit availability/source, evidence retention and relevant selection metrics only when measured. Unknown token usage remains unknown; bytes do not become money or tokens. Model reason text never becomes an automatic proof.

A readable summary should lead with the failed criteria, expected versus actual, a source/citation mismatch where applicable, and the command needed for offline replay. Keep raw transcripts available as explicit artifacts rather than embedding megabytes in every view. Record hashes for all external fixture files and the grader version. A renderer can read existing schemaVersion 1 reports; a new run schema need not silently reinterpret them.

Recommended validation order is structure → identity/lineage → exact facts/relations → citation resolution → contradiction/unsupported claims → independent review for judgments not deterministically testable. For sample prose, negative controls are essential: swapped owners/counts, by/on date changes, purchases work/fail negations, reversed numerical comparisons, invented reviewers, valid-but-wrong labels, and fabricated/real-but-irrelevant citations. The saved failures already supply several regression fixtures without making a model call.

## User journeys and wording

**Install and first useful command.** The offline exact tutorial works and help/version start without loading providers or extensions. It proves input handling and record identity, but does not yet demonstrate the semantic value. **Proposal:** follow it immediately with an explicit mock/example semantic transformation showing original value → annotation → exact selection/projection → typed output and the check that can fail. Label illustrative/mock output as such. Make real-model reproduction a separate explicit route step with a small request bound.

**Choose a model.** Local and hosted endpoints are explicit and no fallback is implemented. Setup/doctor need readiness distinctions, route inspect needs real arguments, and the model page needs layered verdicts. **Proposal:** phrase guidance as “Choose a route for this task and verify these outputs”; neither local hardware nor a universal small model is required. Mixed annotation preserved evidence in the historical triage/context runs but increased final-boundary bytes and elapsed time versus direct stronger calls. Parent market work should compare LLM+jq and manual evidence preparation on the same task before claiming savings.

**Reuse a command.** YAML defaults and exact installed type versions work; local commands resolve from the current directory, not ancestor directories. One malformed definition can poison named-command discovery. **Proposal:** show working-directory expectations, profile overrides, parsed defaults, and validation output beside one short reusable command. Keep types/configuration/version terms consistent.

**Author an extension with an agent.** Typed code, generated bindings/manifests, dormant help/plan, and offline fixture replay form a plausible differentiator. Fixture failure messages are weak, Zod conversion is intentionally restricted, and check/test/add execute trusted code. **Proposal:** expose the supported schema subset and trust boundary in the scaffold workflow; produce a meaningful fixture diff and demonstrate an invalid result being refused. Source hashes establish freshness, not safety or publisher identity.

**Prepare engineering evidence.** read/find retain real content and source paths. The failing-CI guide's captured log/diff and controlled structured diagnosis, date-fns' pinned source excerpts, and gh-evidence's bounded GET/replay normalizer are stronger proof patterns than generic chat prose. Current runtime schema cannot validate that a model's cited source line supports its statement; the failing-CI test checks references for controlled replies. **Proposal:** make a deterministic path/line/quote verifier reusable and show observations, hypotheses, and next checks in separate fields. Do not assert a model fixed the issue or ran checks.

**Review results.** Record streams can contain valid prefixes after failure, and bare JSONL drops metadata. **Proposal:** give a “capture safely and inspect” example with exit status/pipefail and a trace/report view that does not mix stderr into data. Avoid hiding controls inside verbose terminal output.

Source-backed positioning candidate: **“Reusable model commands that keep your records, routes, and checks explicit.”** Supporting copy: “Transform selected evidence, preserve original records, validate output contracts, and choose the model for each command or flow step.” This is a proposal, not a tested market winner. The frog line “Small commands. Big hops.” can remain a secondary brand cue. Lead demonstrations with a recognizable input/output task before framework vocabulary. “Typed” must mean supported structural constraints, not truth; “evidence” must distinguish original source, model annotation, and independently checked claim. Current product-direction already correctly states that exact Unix tools are sufficient and every additional model stage needs a reason. [product direction](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/docs/product-direction.md#L21).

## Viable product directions

| Direction and audience | Why current code supports it | Prerequisites and tradeoffs | Evidence needed before promotion |
| --- | --- | --- | --- |
| **Repeatable semantic record transformations** for shell users with tickets, notes, or documents | Classify/map/extract preserve identity and annotations; exact projection/equality and reusable YAML already compose | Fix schema/help/route inspection; expose label evidence and request counts; make one self-contained npm path. Sequential per-record requests and weaker-model mistakes constrain throughput and unattended use | Compare same task against LLM+jq and hand-written scripts; independent review of negations/unknowns and retained originals; measure time to first useful result |
| **Bounded engineering evidence briefs** for maintainers and coding harness users | read/find, explicit source records, pinned contribution/CI fixtures, structured diagnosis, gh GET acquisition/replay and handoff seam | Reusable citation/quote/path/line checks, bounded context selection, robust acquisition status. Source retention does not prove relevance or truthful interpretation; trusted extensions remain explicit | Real sanitized maintainer tasks with original expected findings; source-support precision, missed relevant evidence, reviewer time, direct-model/manual-context baseline |
| **Typed commands authored by agents and reviewed by developers** for teams maintaining reusable transformations | TypeScript/Zod authoring, generated SDK contracts/manifests, YAML reuse, dormant discovery, exact versions and installed freshness | Better fixture diffs, schema subset/parity guarantees, explicit trust review, portability/version policy. Larger initial learning cost and bundled compiler/SDK maintenance; no sandbox or public extension registry today | Small pilot where a developer can review and reuse an agent-authored command; invalid-output refusal, easy upgrade/rollback, source and fixture auditability |
| **Task specific model evidence and evaluation exports** as a supporting capability | Existing internal command/workflow reports and loopback adapters capture many necessary artifacts | Versioned criteria/provenance, offline renderer/regrade, useful export/exec adapter before new platform scope. Current broad pass ratios are weak and token cost unknown | Saved-output regression checks, independent rubric review, paired/randomized timing runs, measured criteria; parent compares existing evaluator integrations |

The first two are the clearest user-facing entry points. The third is a credible expansion after a useful built-in workflow demonstrates value. The fourth supports trust in all three and should not force Ribbit into a separate agent orchestrator or broad evaluation platform. None requires automatic cloud fallback, subscriptions, or a model download manager.

## Prioritized implementation backlog

These are proposed work items for the parent to split and orchestrate. Dependency arrows identify order, not parallel execution already performed.

| Order | Work and implementation seam | Acceptance test | Dependency and risk |
| --- | --- | --- | --- |
| **A1 P1** | Preserve saved artifacts; add a new offline rubric/regrade record and layered criteria in cases/workflows/reporting | Saved triage/context/chunk/size/deadline failures fail the new appropriate criterion; correct originals pass; all six accepted contradiction controls fail; historical verdicts remain byte-for-byte intact | First proof task. Avoid overfitting prose regex; use structured exact facts/citations plus independent review where needed |
| **A2 P1** | Fix schema parity in build/schema and extraction/inference | AJV/conversion agree on enum/const/anyOf siblings and nested/nullable/bound/default cases, or unsupported combinations fail before provider invocation; invalid mock replies repair/fail, never pass | Before promising typed extraction. Generated validators/catalog must be rebuilt consistently; Zod private internals are an upgrade risk |
| **A3 P2** | Generate truthful action and management help from CLI/parser/manifest contracts | Every advertised argument/example runs; where offers typed args-json; enums/defaults/required/budgets visible; provider add has real help; boolean false stays false; discovery imports/calls remain dormant | Can proceed after contract decisions; help snapshots alone are insufficient |
| **A4 P2** | Concrete argument-aware route inspection and readiness checks in admin/runtime | find about/tree describe/pick about inspection predicts execution route without HTTP; exact cases show no inference; empty doctor shows route unavailable; supported/old/missing fzf distinguished | Follow A3 parsing reuse; guard privacy/no-fallback and extension dormancy |
| **A5 P2** | Define stable optional trace/result provenance in runtime/flows/records; preserve short reasons/supporting quotes deliberately | Two-step mixed flow attributes requests to steps/records/settings; originals survive; annotate/export behavior is explicit; trace has bounded size and stdout stays data | A1 criterion design informs trace fields; schema compatibility and captured input privacy require explicit choices |
| **A6 P2** | Offline report renderer/exporter plus richer fixture diagnostics in scaffold/release scripts | Existing schemaVersion 1 reports render without inference; failures show criterion/expected/actual/path; interrupted/unknown token cases render accurately; old stats do not become inferred cost | A1/A5. Prefer separate raw artifacts to 7.8 MB inline response records; do not build arbitrary eval orchestration by default |
| **A7 P2** | Fix conditional map capability requirements across manifests/runtime/flows | Object-only schema map and text-only text map work; wrong modes fail preflight with no HTTP; help/inspect/plan/run agree | A2/A4. Capability declarations and schema hashes must remain consistent |
| **A8 P2** | One npm onboarding task with actual input, output, check, explicit route, and reusable command; move advanced clone prerequisites forward | Clean supported Linux npm/native installation follows guide without repository/Bun for the first task; mocked path needs no model; live path requires explicit configured route; pasted expected output labels its origin | A1–A4. Parent owns wording/site integration; do not advertise unverified quality/speed |
| **A9 P2** | Reusable source/line/quote verification for engineering briefs and acquisition completeness | Fabricated path/line, real-but-unsupported quote, incomplete acquisition, contradictory fact, empty evidence and unknown label fail or remain explicit; controlled diagnosis passes | A2/A5; integrate example verifier pattern rather than imply schema proves citations |
| **A10 P3** | Docs/release freshness and package size review | Release checklist version matches package/public release; evidence links pin revision; relevant source/example changes trigger docs build; measure archive/installed sizes before reducing contents | Independent maintenance task; broad slimming must preserve notices, adjacent SDK and documented offline examples |
| **A11 P2** | Pilot and performance evidence after selecting direction | Prespecified tasks/criteria, held-out or independently reviewed outputs, paired/randomized direct-model and LLM+jq baselines, per-task request/token availability/latency/reviewer time; retain all failures | A1/A8 or A9. Success criteria decided before run; no paid/live inference in this audit |

Risk hotspots are JSON Schema/Zod semantic drift and private Zod internals; lazy stream cancellation/error prefixes; cumulative budgets across materialized/reused flow outputs; no step/request attribution; trusted extension top-level execution/source freshness; sensitive evidence in raw eval artifacts; filesystem path/ignore/symlink boundaries; and differences between native installs, npm wrapper installs, and Windows interactive consoles. Existing tests cover many low-level invariants; they do not remove the need for targeted regressions at these seams.

## Representative actual outputs

The next sections contain audit-captured packaged CLI results and selected historical evaluation outputs. Mocked provider output is explicitly marked. Timing numbers measure this audit host or the original saved host, respectively; they are not comparable across machines. Full supporting local logs are in `/workspace/ribbit-audit/` and the report embeds the material evidence needed for parent review.

### management help

Invocation arguments: `["providers", "add", "--help"]`

Exit status: **0**.

stdout:

```text
Ribbit — Small commands. Big hops.

Usage: ribbit COMMAND [arguments]

Commands:
  ask, classify, compare, explain, extract, filter, find, group, ls, map, pick, rank, read, reduce, render, rewrite, select, sort, summarize, take, tree, unique, where

Management:
  providers, profiles, models, route, commands, types, extensions, init, completions, setup, doctor, run, flow

Use ribbit COMMAND --help or ribbit types describe @ribbit/COMMAND --json.
```


### where help

Invocation arguments: `["where", "--help"]`

Exit status: **0**.

stdout:

```text
ribbit where — Keep records whose field strictly equals a scalar

Type: @ribbit/where
Action: run
Defaults: {}

  --field <string> (positional)
  --equals <json>

Input: records; output: records.
Runtime: --input auto|text|lines|jsonl|records, --output records|jsonl|text|json,
--file PATH, --profile NAME, --provider NAME, --model NAME, --stats, --error-format json.
```


### where guessed equals

Invocation arguments: `["where", "ok", "--equals", "true", "--input", "jsonl", "--error-format", "json"]`

Input:

```text
{"ok":true}
```

Exit status: **2**.

stderr:

```text
{"schemaVersion":1,"error":{"code":2,"message":"Complex arguments require --args-json"}}
```


### where typed equals

Invocation arguments: `["where", "ok", "--args-json", "{\"equals\":true}", "--input", "jsonl"]`

Input:

```text
{"ok":true}
{"ok":false}
```

Exit status: **0**.

stdout:

```text
{"$ribbit":{"version":1,"kind":"records"}}
{"id":"1","value":{"ok":true},"source":{"lineStart":1,"lineEnd":1},"annotations":{}}
```


### exact sort

Invocation arguments: `["sort", "--by", "n", "--type", "number", "--input", "jsonl", "--stats"]`

Input:

```text
{"name":"two","n":2}
{"name":"ten","n":10}
{"name":"one","n":1}
```

Exit status: **0**.

stdout:

```text
{"$ribbit":{"version":1,"kind":"records"}}
{"id":"3","value":{"name":"one","n":1},"source":{"lineStart":3,"lineEnd":3},"annotations":{}}
{"id":"1","value":{"name":"two","n":2},"source":{"lineStart":1,"lineEnd":1},"annotations":{}}
{"id":"2","value":{"name":"ten","n":10},"source":{"lineStart":2,"lineEnd":2},"annotations":{}}
```

stderr:

```text
{"schemaVersion":1,"requests":0,"repairs":0,"retries":0,"routes":[],"tokens":0,"elapsedMs":56.093895}
```


### exact select

Invocation arguments: `["select", "name", "--output", "jsonl"]`

Input:

```text
{"$ribbit":{"version":1,"kind":"records"}}
{"id":"3","value":{"name":"one","n":1},"source":{"lineStart":3,"lineEnd":3},"annotations":{}}
{"id":"1","value":{"name":"two","n":2},"source":{"lineStart":1,"lineEnd":1},"annotations":{}}
```

Exit status: **0**.

stdout:

```text
{"name":"one"}
{"name":"two"}
```


### classify reason

Invocation arguments: `["classify", "--field", "body", "--labels", "blocking,cosmetic", "--stats"]`

Input:

```text
{"$ribbit":{"version":1,"kind":"records"}}
{"id":"T1","value":{"body":"Purchases work; help has typo."},"source":{"path":"tickets.jsonl","lineStart":1},"annotations":{"prior":true}}
```

Provider responses are **loopback mocks**, not new model inference.

Mock response: `{reason:"Purchases explicitly work; only spelling is affected.", label:"cosmetic"}`.

Exit status: **0**.

stdout:

```text
{"$ribbit":{"version":1,"kind":"records"}}
{"id":"T1","value":{"body":"Purchases work; help has typo."},"source":{"path":"tickets.jsonl","lineStart":1},"annotations":{"prior":true,"classify":{"label":"cosmetic"}}}
```

stderr:

```text
{"schemaVersion":1,"requests":1,"repairs":0,"retries":0,"routes":[{"provider":"mock","model":"small","source":{"provider":"global","model":"global"}}],"tokens":15,"elapsedMs":90.02271700000001}
```


### render jsonl loss

Invocation arguments: `["render", "--as", "jsonl"]`

Input:

```text
{"$ribbit":{"version":1,"kind":"records"}}
{"id":"T1","value":{"body":"Purchases work; help has typo."},"source":{"path":"tickets.jsonl","lineStart":1},"annotations":{"prior":true,"classify":{"label":"cosmetic"}}}
```

Exit status: **0**.

stdout:

```text
{"body":"Purchases work; help has typo."}
```


### route find default

Invocation arguments: `["route", "inspect", "find", "--json"]`

Exit status: **0**.

stdout:

```text
{"schemaVersion":1,"inference":false,"effects":["filesystem-read"]}
```


### route find about

Invocation arguments: `["route", "inspect", "find", "--about", "session expiration", "--json"]`

Exit status: **2**.

stderr:

```text
ribbit: Unknown management flag --about
```


### find semantic

Invocation arguments: `["find", "repository", "--about", "session expiration", "--read", "content", "--stats"]`

Provider responses are **loopback mocks**, not new model inference.

Exit status: **0**.

stdout:

```text
{"$ribbit":{"version":1,"kind":"records"}}
{"id":"1","value":{"path":"/tmp/ribbit-release-r0ztoF/repository/auth.ts","relativePath":"auth.ts","kind":"file","sizeBytes":138,"modifiedAt":"2026-10-03T14:10:50.126Z","content":"// Reject expired sessions before accepting a request.\nexport const sessionIsValid = (expiresAt: number, now: number) => expiresAt > now;\n"},"source":{"path":"/tmp/ribbit-release-r0ztoF/repository/auth.ts"},"annotations":{}}
```

stderr:

```text
{"schemaVersion":1,"requests":1,"repairs":0,"retries":0,"routes":[{"provider":"mock","model":"small","source":{"provider":"global","model":"global"}}],"tokens":15,"elapsedMs":47.209405000000004}
```


### extract enum sibling

Invocation arguments: `["extract", "Extract x", "--schema", "enum.schema.json", "--stats"]`

Input:

```text
x
```

Provider responses are **loopback mocks**, not new model inference.

Schema: `{type:"string",enum:["x"],minLength:10}`. Mock structured response: `"x"`.

Exit status: **0**.

stdout:

```text
"x"
```

stderr:

```text
{"schemaVersion":1,"requests":1,"repairs":0,"retries":0,"routes":[{"provider":"mock","model":"small","source":{"provider":"global","model":"global"}}],"tokens":15,"elapsedMs":101.83077199999998}
```


### schema parity

```json
{
  "id": "schema-parity",
  "schema": {
    "type": "string",
    "enum": [
      "x"
    ],
    "minLength": 10
  },
  "value": "x",
  "ajvAccepted": false,
  "zodAccepted": true
}
```


### fixture mismatch

Invocation arguments: `["extensions", "test", "/tmp/ribbit-release-r0ztoF/greeting", "--json"]`

Exit status: **5**.

stdout:

```text
{"schemaVersion":1,"passed":1,"failed":1,"results":[{"file":"echo.json","pass":true},{"file":"wrong.json","pass":false}]}
```


### object only map

Invocation arguments: `["map", "Extract owner", "--schema", "meeting.schema.json", "--input", "lines", "--error-format", "json"]`

Exit status: **3**.

stdout:

```text
{"$ribbit":{"version":1,"kind":"records"}}
```

stderr:

```text
{"schemaVersion":1,"error":{"code":3,"message":"Provider does not support text"}}
```


### object only extract

Provider responses are **loopback mocks**, not new model inference.

Exit status: **0**.

stdout:

```text
{"owner":"Mina","reviewer":null}
```


### doctor empty

Exit status: **0**.

stdout:

```text
{"schemaVersion":1,"checks":[{"name":"configuration","ok":true},{"name":"picker","ok":true}],"ok":true}
```


### empty route

Exit status: **3**.

stderr:

```text
ribbit: No complete route; configure a provider and model
```


### flow budget cumulative

Invocation arguments: `["flow", "run", "--input", "jsonl", "--max-records", "3", "--stats", "--", "take", "3", "::", "take", "3"]`

Input:

```text
1
2
3
```

Exit status: **6**.

stdout:

```text
{"$ribbit":{"version":1,"kind":"records"}}
{"id":"1","value":1,"source":{"lineStart":1,"lineEnd":1},"annotations":{}}
```

stderr:

```text
{"schemaVersion":1,"requests":0,"repairs":0,"retries":0,"routes":[],"tokens":0,"elapsedMs":38.814096000000006}
ribbit: records budget exceeded (3)
```


### stream prefix then error

Invocation arguments: `["select", "ok", "--input", "jsonl", "--error-format", "json"]`

Input:

```text
{"ok":1}
{broken
```

Exit status: **2**.

stdout:

```text
{"$ribbit":{"version":1,"kind":"records"}}
{"id":"1","value":{"ok":1},"source":{"lineStart":1,"lineEnd":1},"annotations":{}}
```

stderr:

```text
{"schemaVersion":1,"error":{"code":2,"message":"Malformed JSON or non-finite value","location":"line 2"}}
```


## Historical evaluation counterexamples

All outputs below are copied from the saved reports. Their recorded verdict is `pass:true`; the audit identifies the stated failed factual criterion. No raw report was changed.

### explain audience

The file/limit comparison is contradictory. Source: [saved output](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/evals/results/release/2026-09-20T14-55-34-078Z-ribbit-release-small/report.json#L229), attempt `explain-audience`, repetition 1.

```json
{
  "id": "explain-audience",
  "repetition": 1,
  "code": 0,
  "pass": true,
  "failure": null,
  "out": "The upload failed because it exceeded the allowed size of 12 MB but did not reach the maximum limit of 8 MB. The file could not be saved due to exceeding the storage capacity.\n"
}
```

### reduce chunked

Jo owns 7 tasks is replaced by disconnected fragments. Source: [saved output](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/evals/results/release/2026-09-20T14-51-55-840Z-google_gemma-4-e4b/report.json#L1176), attempt `reduce-chunked`, repetition 1.

```json
{
  "id": "reduce-chunked",
  "repetition": 1,
  "code": 0,
  "pass": true,
  "failure": null,
  "out": "The provided partial summaries contain the following data points: Mina owns 24 tasks. Another entry mentions Jo ow. Additionally, there is a query regarding \"ns 7 tasks,\" noting that context for what \"ns\" refers to or the overall goal is needed for accurate assistance.\n"
}
```

### summarize facts

The deadline changes from by Friday to on Friday. Source: [saved output](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/evals/results/release/2026-09-20T14-55-34-078Z-ribbit-release-small/report.json#L165), attempt `summarize-facts`, repetition 1.

```json
{
  "id": "summarize-facts",
  "repetition": 1,
  "code": 0,
  "pass": true,
  "failure": null,
  "out": "Mina will fix checkout on Friday. Budget: 240 euros. No reviewer assigned.\n"
}
```

### reduce evidence

Required explicit record citations a/b are absent in repetition 1. Source: [saved output](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/evals/results/release/2026-09-20T14-55-34-078Z-ribbit-release-small/report.json#L1109), attempt `reduce-evidence`, repetition 1.

```json
{
  "id": "reduce-evidence",
  "repetition": 1,
  "code": 0,
  "pass": true,
  "failure": null,
  "out": "The issue with the feedback data is that checkout fails for all customers. The component responsible for this is \"checkout\". \n\nOn the other hand, the issue with the feedback data is that help text has a typo; purchases work. The component responsible for this is \"docs\".\n"
}
```

### Workflow triage

Source: [saved final output](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/evals/results/workflows/2026-09-20T14-55-49-560Z/report.json#L113), local-only repetition 1.

```json
{
  "recipe": "triage",
  "mode": "local-only",
  "repetition": 1,
  "pass": true,
  "failure": null,
  "final": "The tickets have been prioritized based on their severity and impact:\n\n1. **R1** - This ticket is labeled as \"blocking\" because it affects every customer, resulting in revenue being blocked.\n2. **R2** - This ticket is also labeled as \"blocking\" due to a spelling mistake in the help page, which prevents purchases from working.\n3. **R3** - This ticket has been classified as \"blocking\" because a screen reader cannot reach the purchase button, and keyboard users are blocked.\n\nThe tickets have been treated as fallible suggestions; verified against original bodies, and separated into observations (tickets with issues) and hypotheses (tickets that do not affect revenue).\n",
  "evidenceRetention": 1,
  "falseNegativesFromSelection": 0
}
```

### Workflow context

Source: [saved final output](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/evals/results/workflows/2026-09-20T14-55-49-560Z/report.json#L410), local-only repetition 1.

```json
{
  "recipe": "context",
  "mode": "local-only",
  "repetition": 1,
  "pass": true,
  "failure": null,
  "final": "The source that implements session expiration is `auth.ts`. This file contains a function named `sessionIsValid` which takes two parameters: `expiresAt` and `now`, and returns true if the session expires before the current time. The function uses the condition `expiresAt > now` to determine whether the session should be rejected based on its expiration date.\n\nThe source that implements colors is `colors.ts`. This file contains a constant named `headerColor` which sets the color for the navigation header.\n",
  "evidenceRetention": 1,
  "falseNegativesFromSelection": 0
}
```

### Workflow brief

Source: [saved final output](https://github.com/funsaized/ribbit/blob/be6e7ed90e6a5f8c4a032520ec724ef417cf784a/evals/results/workflows/2026-09-20T14-55-49-560Z/report.json#L683), local-only repetition 1.

```json
{
  "recipe": "brief",
  "mode": "local-only",
  "repetition": 1,
  "pass": true,
  "failure": null,
  "final": "Mina will fix the checkout on Friday. The budget is 240 euros. There are no reviewers assigned.\n",
  "evidenceRetention": null,
  "falseNegativesFromSelection": null
}
```

### Offline synthetic controls

These deliberately incorrect strings were executed through the **current** original case checkers. All six were accepted. They are audit controls, not model outputs.

```json
[
  {
    "id": "summarize-facts",
    "out": "Mina refuses to fix checkout by Friday. The budget is not 240 euros. Kai is assigned as reviewer.",
    "acceptedByCurrentCheck": true,
    "error": null
  },
  {
    "id": "explain-audience",
    "out": "The upload succeeded because 12 MB is smaller than the 8 MB limit; a file was saved.",
    "acceptedByCurrentCheck": true,
    "error": null
  },
  {
    "id": "rewrite-facts",
    "out": "Mina refuses to fix checkout by Friday. The budget is not 240 euros. Kai is assigned as reviewer.",
    "acceptedByCurrentCheck": true,
    "error": null
  },
  {
    "id": "reduce-evidence",
    "out": "A checkout typo affects b and a.",
    "acceptedByCurrentCheck": true,
    "error": null
  },
  {
    "id": "reduce-chunked",
    "out": "Mina 24; Jo 7. No relationship between these names and numbers is established.",
    "acceptedByCurrentCheck": true,
    "error": null
  },
  {
    "id": "compare-sources",
    "out": "Sources: before.txt | after.txt\nThe retry limit decreased from 5 to 2. Mina is no longer owner.",
    "acceptedByCurrentCheck": true,
    "error": null
  }
]
```

## Audit startup measurements

The documented benchmark made no model calls. On this Linux x64 AMD EPYC 7763 audit host with Bun 1.4.0, 30 measured processes per command (first warmup excluded) produced the following wall times. The native help/version <=100 ms p95 gate passed. These measurements do not prove large-input memory, npm-wrapper overhead, model throughput, or performance on other operating systems.

| Command | p50 ms | p95 ms |
| --- | --- | --- |
| help | 50.54 | 81.03 |
| version | 61.00 | 98.36 |
| take | 77.81 | 89.11 |

## Complete tracked file coverage

R means full manual source/text read; G means generated artifact reviewed structurally with the limits above; S means inventoried but body skipped. Execution notes describe the offline gate or build/input use rather than a line-coverage measurement. All 38 first-party test files executed. Source was read and built; no claim is made that every branch ran. Remote CI workflows were read, not triggered. Live eval runners, dataset acquisition, publication, notice rewriting, and command-example rewriting were not executed.

| Tracked path | Bytes | Read | Execution or disposition |
| --- | ---: | --- | --- |
| `.gitattributes` | 166 | R | Read/build/configuration input; no separate execution |
| `.github/ISSUE_TEMPLATE/bug_report.md` | 427 | R | Read/build/configuration input; no separate execution |
| `.github/pull_request_template.md` | 163 | R | Read/build/configuration input; no separate execution |
| `.github/workflows/ci.yml` | 2002 | R | Read only; remote workflow not triggered |
| `.github/workflows/docs.yml` | 1384 | R | Read only; remote workflow not triggered |
| `.github/workflows/publish-github-package.yml` | 4320 | R | Read only; remote workflow not triggered |
| `.gitignore` | 106 | R | Read/build/configuration input; no separate execution |
| `.markdownlint-cli2.yaml` | 79 | R | Read/build/configuration input; no separate execution |
| `.oxfmtrc.json` | 468 | R | Read/build/configuration input; no separate execution |
| `.oxlintrc.json` | 1784 | R | Read/build/configuration input; no separate execution |
| `CHANGELOG.md` | 2121 | R | Read/build/configuration input; no separate execution |
| `CONTRIBUTING.md` | 2392 | R | Read/build/configuration input; no separate execution |
| `LICENSE` | 1071 | R | Read/build/configuration input; no separate execution |
| `README.md` | 7534 | R | Read/build/configuration input; no separate execution |
| `Ribbit-PRD.md` | 11925 | R | Read/build/configuration input; no separate execution |
| `SECURITY.md` | 1384 | R | Read/build/configuration input; no separate execution |
| `THIRD_PARTY_NOTICES.md` | 9189 | R | Read/build/configuration input; no separate execution |
| `bun.lock` | 30193 | G | Frozen install passed; dependency inventory reviewed |
| `bunfig.toml` | 27 | R | Read/build/configuration input; no separate execution |
| `docs/command-examples.md` | 6747 | R | Docs/link/build input; no publication |
| `docs/commands.md` | 4965 | R | Docs/link/build input; no publication |
| `docs/development.md` | 5610 | R | Docs/link/build input; no publication |
| `docs/explanation/composition.md` | 2314 | R | Docs/link/build input; no publication |
| `docs/explanation/index.md` | 850 | R | Docs/link/build input; no publication |
| `docs/explanation/model-chaining.md` | 2626 | R | Docs/link/build input; no publication |
| `docs/explanation/recipes.md` | 3397 | R | Docs/link/build input; no publication |
| `docs/explanation/trust.md` | 2475 | R | Docs/link/build input; no publication |
| `docs/extensions.md` | 2671 | R | Docs/link/build input; no publication |
| `docs/how-to/analyze-open-data.md` | 4933 | R | Docs/link/build input; no publication |
| `docs/how-to/build-extension.md` | 1933 | R | Docs/link/build input; no publication |
| `docs/how-to/configure-models.md` | 2817 | R | Docs/link/build input; no publication |
| `docs/how-to/handoff-context.md` | 3045 | R | Docs/link/build input; no publication |
| `docs/how-to/handoff-date-fns.md` | 2915 | R | Docs/link/build input; no publication |
| `docs/how-to/index.md` | 1267 | R | Docs/link/build input; no publication |
| `docs/how-to/investigate-failing-ci.md` | 3752 | R | Docs/link/build input; no publication |
| `docs/how-to/reuse-commands.md` | 1575 | R | Docs/link/build input; no publication |
| `docs/how-to/route-workflows.md` | 2316 | R | Docs/link/build input; no publication |
| `docs/how-to/triage-feedback.md` | 1927 | R | Docs/link/build input; no publication |
| `docs/how-to/troubleshoot.md` | 2706 | R | Docs/link/build input; no publication |
| `docs/index.md` | 2205 | R | Docs/link/build input; no publication |
| `docs/installation.md` | 5138 | R | Docs/link/build input; no publication |
| `docs/models.md` | 4384 | R | Docs/link/build input; no publication |
| `docs/product-direction.md` | 5087 | R | Docs/link/build input; no publication |
| `docs/recipes.md` | 2454 | R | Docs/link/build input; no publication |
| `docs/reference/configuration.md` | 3364 | R | Docs/link/build input; no publication |
| `docs/reference/definitions.md` | 1667 | R | Docs/link/build input; no publication |
| `docs/reference/flows.md` | 2272 | R | Docs/link/build input; no publication |
| `docs/reference/index.md` | 1278 | R | Docs/link/build input; no publication |
| `docs/reference/management.md` | 2099 | R | Docs/link/build input; no publication |
| `docs/reference/records.md` | 4778 | R | Docs/link/build input; no publication |
| `docs/reference/runtime.md` | 2650 | R | Docs/link/build input; no publication |
| `docs/release-acceptance.md` | 5761 | R | Docs/link/build input; no publication |
| `docs/release-checklist.md` | 6083 | R | Docs/link/build input; no publication |
| `docs/release-notes-0.1.0-alpha.1.md` | 2832 | R | Docs/link/build input; no publication |
| `docs/release-notes-0.1.0-alpha.2.md` | 1686 | R | Docs/link/build input; no publication |
| `docs/stylesheets/extra.css` | 458 | R | Docs/link/build input; no publication |
| `docs/third-party/_cacheable_memory-2.2.0.txt` | 1053 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_cacheable_utils-2.5.0.txt` | 1053 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_eslint-community_eslint-utils-4.10.1.txt` | 1071 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_eslint-community_regexpp-4.12.2.txt` | 1071 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_eslint_config-array-0.23.5.txt` | 11357 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_eslint_config-helpers-0.7.0.txt` | 11357 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_eslint_core-1.2.1.txt` | 11357 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_eslint_object-schema-3.0.5.txt` | 11357 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_eslint_plugin-kit-0.7.3.txt` | 11357 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_humanfs_core-0.19.2.txt` | 11357 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_humanfs_node-0.16.8.txt` | 11357 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_humanwhocodes_module-importer-1.0.1.txt` | 11357 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_humanwhocodes_retry-0.4.3.txt` | 11357 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_keyv_bigmap-1.3.1.txt` | 1062 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_keyv_serialize-1.1.1.txt` | 1108 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_stylistic_eslint-plugin-5.10.0.txt` | 1164 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_types_bun-1.3.3.txt` | 1141 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_types_esrecurse-4.3.1.txt` | 1141 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_types_estree-1.0.9.txt` | 1141 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_types_json-schema-7.0.15.txt` | 1141 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_types_node-24.10.1.txt` | 1141 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/_typescript-eslint_types-8.70.0.txt` | 1097 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/acorn-8.18.0.txt` | 1099 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/acorn-jsx-5.3.2.txt` | 1068 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/ajv-6.15.0.txt` | 1090 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/ajv-8.18.0.txt` | 1090 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/balanced-match-4.0.4.txt` | 1155 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/brace-expansion-5.0.12.txt` | 1144 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/bun-1.4.0.txt` | 5613 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/cacheable-2.5.0.txt` | 1053 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/cross-spawn-7.0.6.txt` | 1105 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/debug-4.4.3.txt` | 1139 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/deep-is-0.1.4.txt` | 1237 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/escape-string-regexp-4.0.0.txt` | 1117 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/eslint-10.10.0.txt` | 1094 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/eslint-scope-9.1.2.txt` | 1390 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/eslint-visitor-keys-3.4.3.txt` | 11337 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/eslint-visitor-keys-4.2.1.txt` | 11337 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/eslint-visitor-keys-5.0.1.txt` | 11337 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/espree-10.4.0.txt` | 1322 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/espree-11.2.0.txt` | 1322 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/esquery-1.7.0.txt` | 1488 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/estraverse-5.3.0.txt` | 1231 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/esutils-2.0.3.txt` | 1231 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/fast-deep-equal-3.1.3.txt` | 1074 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/fast-json-stable-stringify-2.1.0.txt` | 1145 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/fast-levenshtein-2.0.6.txt` | 1100 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/fast-uri-3.1.7.txt` | 1813 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/file-entry-cache-11.1.5.txt` | 1053 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/find-up-5.0.0.txt` | 1117 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/flat-cache-6.1.23.txt` | 1053 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/flatted-3.4.4.txt` | 770 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/glob-parent-6.0.2.txt` | 857 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/hashery-1.5.1.txt` | 1067 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/hookified-1.15.1.txt` | 1052 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/hookified-2.2.0.txt` | 1052 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/ignore-5.3.2.txt` | 1095 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/ignore-7.0.5.txt` | 1095 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/is-extglob-2.1.1.txt` | 1087 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/is-glob-4.0.3.txt` | 1088 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/isexe-2.0.0.txt` | 765 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/json-schema-traverse-0.4.1.txt` | 1074 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/json-schema-traverse-1.0.0.txt` | 1074 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/json-stable-stringify-without-jsonify-1.0.1.txt` | 1073 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/keyv-5.6.0.txt` | 1108 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/levn-0.4.1.txt` | 1054 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/locate-path-6.0.0.txt` | 1117 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/minimatch-10.2.6.txt` | 1550 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/mkdocs-1.6.1.txt` | 1292 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/mkdocs-material-9.7.7.txt` | 1093 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/ms-2.1.3.txt` | 1079 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/optionator-0.9.4.txt` | 1054 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/oxfmt-0.65.0.txt` | 1119 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/oxlint-1.83.0.txt` | 1119 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/p-limit-3.1.0.txt` | 1117 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/p-locate-5.0.0.txt` | 1117 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/path-exists-4.0.0.txt` | 1109 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/path-key-3.1.1.txt` | 1109 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/picomatch-4.0.7.txt` | 1091 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/prelude-ls-1.2.1.txt` | 1054 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/punycode-2.3.1.txt` | 1077 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/qified-0.10.1.txt` | 1052 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/require-from-string-2.0.2.txt` | 1128 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/shebang-command-2.0.0.txt` | 1116 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/shebang-regex-3.0.0.txt` | 1109 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/tinypool-2.1.0.txt` | 1209 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/type-check-0.4.0.txt` | 1054 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/typescript-5.9.3.txt` | 9197 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/typescript-third-party.txt` | 37824 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/undici-types-7.16.0.txt` | 1090 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/uri-js-4.4.1.txt` | 1452 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/which-2.0.2.txt` | 765 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/word-wrap-1.2.5.txt` | 1087 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/yaml-2.8.3.txt` | 738 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/yocto-queue-0.1.0.txt` | 1117 | S | Body skipped; inventory/link/hash only |
| `docs/third-party/zod-4.1.13.txt` | 1072 | S | Body skipped; inventory/link/hash only |
| `docs/tutorials/first-pipeline.md` | 2219 | R | Docs/link/build input; no publication |
| `docs/tutorials/index.md` | 720 | R | Docs/link/build input; no publication |
| `docs/tutorials/local-model.md` | 3006 | R | Docs/link/build input; no publication |
| `docs/tutorials/reusable-command.md` | 2323 | R | Docs/link/build input; no publication |
| `docs/usage.md` | 2556 | R | Docs/link/build input; no publication |
| `evals/README.md` | 3197 | R | Read/build/configuration input; no separate execution |
| `evals/results/handoff/2026-09-20T14-58-06-865Z/context.records` | 863 | G | Parsed offline; all final outputs read; raw SSE sampled |
| `evals/results/handoff/2026-09-20T14-58-06-865Z/report.json` | 3808 | G | Parsed offline; all final outputs read; raw SSE sampled |
| `evals/results/release-environment.json` | 775 | G | Parsed offline; all final outputs read; raw SSE sampled |
| `evals/results/release/2026-09-20T14-51-55-840Z-google_gemma-4-e4b/report.json` | 7789161 | G | Parsed offline; all final outputs read; raw SSE sampled |
| `evals/results/release/2026-09-20T14-51-55-840Z-google_gemma-4-e4b/report.original.json` | 7787186 | G | Parsed offline; all final outputs read; raw SSE sampled |
| `evals/results/release/2026-09-20T14-55-34-078Z-ribbit-release-small/report.json` | 725594 | G | Parsed offline; all final outputs read; raw SSE sampled |
| `evals/results/release/2026-09-20T14-55-34-078Z-ribbit-release-small/report.original.json` | 723744 | G | Parsed offline; all final outputs read; raw SSE sampled |
| `evals/results/workflows/2026-09-20T14-55-49-560Z/report.json` | 186904 | G | Parsed offline; all final outputs read; raw SSE sampled |
| `examples/commands/brief.yaml` | 212 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/commands/contribution-brief.yaml` | 764 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/commands/diagnose-ci.yaml` | 895 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/commands/gh-evidence.yaml` | 128 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/extensions/gh-evidence/README.md` | 4663 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/extensions/gh-evidence/fixtures/deleted-author.json` | 1271 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/extensions/gh-evidence/fixtures/empty.json` | 891 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/extensions/gh-evidence/fixtures/invalid-number.json` | 119 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/extensions/gh-evidence/fixtures/invalid-path.json` | 99 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/extensions/gh-evidence/fixtures/invalid-run.json` | 114 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/extensions/gh-evidence/fixtures/malformed.json` | 60 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/extensions/gh-evidence/fixtures/normal.json` | 1401 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/extensions/gh-evidence/index.ts` | 9766 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/extensions/gh-evidence/package.json` | 172 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/flows/brief.yaml` | 209 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/flows/context.yaml` | 523 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/flows/date-fns-context.yaml` | 414 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/flows/diagnose-ci.yaml` | 366 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/flows/squirrel-report.yaml` | 513 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/flows/triage.yaml` | 776 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/squirrel-report/acquire.sh` | 1079 | R | Not executed; external acquisition excluded |
| `examples/squirrel-report/normalize.ts` | 4412 | R | Executed via offline release tests |
| `examples/squirrel-report/observations.schema.json` | 346 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `examples/squirrel-report/report.ts` | 2464 | R | Executed via offline release tests |
| `examples/squirrel-report/verify-report.ts` | 2941 | R | Executed via offline release tests |
| `fixtures/flows/exact.yaml` | 185 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/flows/future-reference.yaml` | 205 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/release/after.txt` | 41 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/release/before.txt` | 41 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/release/feedback.jsonl` | 327 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/release/meeting.schema.json` | 158 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/release/meeting.txt` | 90 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/release/repository/auth.ts` | 138 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/release/repository/colors.ts` | 80 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/routes/precedence.json` | 8841 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/date-fns/AGENTS.md` | 1210 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/date-fns/CONTRIBUTING.md` | 3070 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/date-fns/LICENSE.md` | 1117 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/date-fns/PROVENANCE.md` | 2999 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/date-fns/pkgs/core/package.json` | 717 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/date-fns/pkgs/core/src/constants/index.ts` | 920 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/date-fns/pkgs/core/src/parseISO/index.ts` | 8965 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/date-fns/pkgs/core/src/parseISO/test.ts` | 15033 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/failing-ci/PROVENANCE.md` | 2646 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/failing-ci/changes.diff` | 243 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/failing-ci/ci.log` | 461 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/failing-ci/diagnose.schema.json` | 1220 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/failing-ci/failure-signature.txt` | 51 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/failing-ci/src/builtins/exact.ts` | 503 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/failing-ci/tests/release/projection-baseline.test.fixture` | 1534 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/squirrels/PROVENANCE.md` | 723 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `fixtures/tutorials/squirrels/sample.json` | 337 | R | Read; supplied as test/example evidence, not all paths instrumented |
| `mkdocs.yml` | 3536 | R | Docs/link/build input; no publication |
| `npm/bin.cjs` | 1170 | R | Executed by mocked installed-package tests |
| `npm/install.cjs` | 3053 | R | Executed by mocked installed-package tests |
| `package.json` | 2126 | R | Read/build/configuration input; no separate execution |
| `requirements-docs.txt` | 528 | R | Read/build/configuration input; no separate execution |
| `scripts/bench.ts` | 1744 | R | Executed directly or by offline gate/package/docs build |
| `scripts/build.ts` | 2385 | R | Executed directly or by offline gate/package/docs build |
| `scripts/docs-hooks.py` | 1111 | R | Executed directly or by offline gate/package/docs build |
| `scripts/docs.ts` | 896 | R | Executed directly or by offline gate/package/docs build |
| `scripts/generate.ts` | 1392 | R | Read/build/configuration input; no separate execution |
| `scripts/platform.ts` | 594 | R | Executed directly or by offline gate/package/docs build |
| `scripts/release/archive-smoke.ts` | 2713 | R | Executed directly or by offline gate/package/docs build |
| `scripts/release/cases.ts` | 11822 | R | Executed directly or by offline gate/package/docs build |
| `scripts/release/docs.ts` | 4552 | R | Not executed; would rewrite tracked examples |
| `scripts/release/evaluate.ts` | 8062 | R | Not executed; would require live inference |
| `scripts/release/handoff.ts` | 3229 | R | Not executed; would require live inference |
| `scripts/release/harness.ts` | 4410 | R | Executed directly or by offline gate/package/docs build |
| `scripts/release/notices.ts` | 2891 | R | Not executed; would rewrite tracked notices |
| `scripts/release/npm-smoke.ts` | 4931 | R | Executed directly or by offline gate/package/docs build |
| `scripts/release/npm.ts` | 5145 | R | Executed directly or by offline gate/package/docs build |
| `scripts/release/package.ts` | 2975 | R | Executed directly or by offline gate/package/docs build |
| `scripts/release/picker.py` | 1870 | R | Executed directly or by offline gate/package/docs build |
| `scripts/release/workflows.ts` | 8550 | R | Not executed; would require live inference |
| `scripts/smoke.ts` | 1490 | R | Executed directly or by offline gate/package/docs build |
| `scripts/verify.ts` | 552 | R | Executed directly or by offline gate/package/docs build |
| `site-overrides/partials/source.html` | 255 | R | Docs/link/build input; no publication |
| `src/build/schema/index.ts` | 6029 | R | Built; module paths covered by offline tests/probes |
| `src/builtins/exact.ts` | 10069 | R | Built; module paths covered by offline tests/probes |
| `src/builtins/filesystem.ts` | 11538 | R | Built; module paths covered by offline tests/probes |
| `src/builtins/index.ts` | 289 | R | Built; module paths covered by offline tests/probes |
| `src/builtins/primitives.ts` | 4768 | R | Built; module paths covered by offline tests/probes |
| `src/builtins/semantic.ts` | 14052 | R | Built; module paths covered by offline tests/probes |
| `src/catalog/index.ts` | 393 | R | Built; module paths covered by offline tests/probes |
| `src/cli/admin/index.ts` | 13356 | R | Built; module paths covered by offline tests/probes |
| `src/cli/io/index.ts` | 4919 | R | Built; module paths covered by offline tests/probes |
| `src/cli/main.ts` | 6797 | R | Built; module paths covered by offline tests/probes |
| `src/cli/parser/index.ts` | 4918 | R | Built; module paths covered by offline tests/probes |
| `src/config/index.ts` | 3998 | R | Built; module paths covered by offline tests/probes |
| `src/definitions/index.ts` | 4010 | R | Built; module paths covered by offline tests/probes |
| `src/engine/execution/index.ts` | 6787 | R | Built; module paths covered by offline tests/probes |
| `src/engine/inference/index.ts` | 4851 | R | Built; module paths covered by offline tests/probes |
| `src/engine/records/index.ts` | 8857 | R | Built; module paths covered by offline tests/probes |
| `src/engine/runtime/index.ts` | 6416 | R | Built; module paths covered by offline tests/probes |
| `src/extensions/build/index.ts` | 4258 | R | Built; module paths covered by offline tests/probes |
| `src/extensions/install/index.ts` | 4804 | R | Built; module paths covered by offline tests/probes |
| `src/extensions/runtime/index.ts` | 482 | R | Built; module paths covered by offline tests/probes |
| `src/filesystem/index.ts` | 8165 | R | Built; module paths covered by offline tests/probes |
| `src/flows/cli.ts` | 5389 | R | Built; module paths covered by offline tests/probes |
| `src/flows/index.ts` | 12485 | R | Built; module paths covered by offline tests/probes |
| `src/generated/catalog.json` | 50536 | G | Regenerated; byte-identical tracked baseline |
| `src/generated/validators.ts` | 86104 | G | Regenerated; byte-identical tracked baseline |
| `src/providers/http/index.ts` | 3071 | R | Built; module paths covered by offline tests/probes |
| `src/providers/interface/index.ts` | 993 | R | Type-checked; type-only interface |
| `src/providers/ollama/index.ts` | 2680 | R | Built; module paths covered by offline tests/probes |
| `src/providers/openai-compatible/index.ts` | 4091 | R | Built; module paths covered by offline tests/probes |
| `src/routing/index.ts` | 3880 | R | Built; module paths covered by offline tests/probes |
| `src/scaffold/index.ts` | 5828 | R | Built; module paths covered by offline tests/probes |
| `src/sdk/index.ts` | 4964 | R | Built; module paths covered by offline tests/probes |
| `src/sdk/manifest/index.ts` | 5830 | R | Built; module paths covered by offline tests/probes |
| `tests/builtins/audit-regressions.test.ts` | 4886 | R | Executed in offline gate |
| `tests/builtins/commands.test.ts` | 8741 | R | Executed in offline gate |
| `tests/builtins/families.test.ts` | 4879 | R | Executed in offline gate |
| `tests/builtins/filesystem.test.ts` | 3829 | R | Executed in offline gate |
| `tests/cli/audit-regressions.test.ts` | 3753 | R | Executed in offline gate |
| `tests/cli/baseline.test.ts` | 408 | R | Executed in offline gate |
| `tests/cli/management.test.ts` | 2119 | R | Executed in offline gate |
| `tests/cli/parser.test.ts` | 1584 | R | Executed in offline gate |
| `tests/cli/pipelines.test.ts` | 1865 | R | Executed in offline gate |
| `tests/conformance/adversarial.test.ts` | 2094 | R | Executed in offline gate |
| `tests/conformance/http-cancellation.test.ts` | 1773 | R | Executed in offline gate |
| `tests/consumer/sdk.test.ts` | 844 | R | Executed in offline gate |
| `tests/definitions/resolution.test.ts` | 1813 | R | Executed in offline gate |
| `tests/execution/budgets.test.ts` | 4504 | R | Executed in offline gate |
| `tests/extensions/cancellation.test.ts` | 2553 | R | Executed in offline gate |
| `tests/extensions/discovery.test.ts` | 3245 | R | Executed in offline gate |
| `tests/extensions/gh-evidence.test.ts` | 10574 | R | Executed in offline gate |
| `tests/extensions/lifecycle.test.ts` | 2142 | R | Executed in offline gate |
| `tests/filesystem/traversal.test.ts` | 4474 | R | Executed in offline gate |
| `tests/flows/flow.test.ts` | 8065 | R | Executed in offline gate |
| `tests/manifests/export.test.ts` | 2048 | R | Executed in offline gate |
| `tests/providers/compatible/protocol.test.ts` | 4123 | R | Executed in offline gate |
| `tests/providers/http.test.ts` | 1395 | R | Executed in offline gate |
| `tests/providers/managed.test.ts` | 3009 | R | Executed in offline gate |
| `tests/providers/ollama/protocol.test.ts` | 3503 | R | Executed in offline gate |
| `tests/records/adapters.test.ts` | 4943 | R | Executed in offline gate |
| `tests/release/commands.test.ts` | 4917 | R | Executed in offline gate |
| `tests/release/date-fns.test.ts` | 4141 | R | Executed in offline gate |
| `tests/release/failing-ci.test.ts` | 6692 | R | Executed in offline gate |
| `tests/release/management.test.ts` | 3981 | R | Executed in offline gate |
| `tests/release/projection-baseline.test.ts` | 1534 | R | Executed in offline gate |
| `tests/release/recipes.test.ts` | 7408 | R | Executed in offline gate |
| `tests/release/squirrels.test.ts` | 5670 | R | Executed in offline gate |
| `tests/routing/resolver.test.ts` | 4560 | R | Executed in offline gate |
| `tests/scaffold/scaffold.test.ts` | 2131 | R | Executed in offline gate |
| `tests/sdk/contract.test.ts` | 3055 | R | Executed in offline gate |
| `tests/unit/baseline.test.ts` | 401 | R | Executed in offline gate |
| `tests/unit/dotenv.test.ts` | 1040 | R | Executed in offline gate |
| `tsconfig.json` | 346 | R | Read/build/configuration input; no separate execution |

## Deliverables and remaining limits

The report contains the findings, architecture, product options, ordered backlog, acceptance criteria, CLI reproductions, historical false-positive examples, and complete tracked inventory. Supporting audit-local files include `coverage-manifest.json` (sizes, classifications, per-file SHA-256 and coverage disposition), `cli-probes.json`, `offline-regrade.json`, `public-distribution.json`, `verify.log`, `package.log`, `docs-build.log`, and `bench.json`. They are outside the checkout; representative contents are embedded above.

No first-party source module remains unread. Limits: no new semantic model run; no independent user study; no real cloud/Ollama/LM Studio endpoint conformance run; no Mac/Windows execution here; no manual full legal review of third-party notices; no line-by-line audit of repeated generated SSE transcript payloads; no live site visual inspection in this workstream. The strict locally built docs/site source was audited; the parent owns live visual/market review. The web reader could not fetch the live homepage, so this workstream does not claim independent live-page rendering verification. None of these limits blocks the planning deliverable.
