# 🐸 Ribbit

**Model tasks that work like commands.**

Ribbit is an extensible framework for composing model tasks into reusable commands, with typed contracts and inspectable evidence. It reads UTF-8 text, JSON values, JSONL, files, and tool output; basically anything you can put in stdin.

[Documentation](https://funsaized.github.io/ribbit/) · [First tutorial](docs/tutorials/first-pipeline.md) · [npm](https://www.npmjs.com/package/@funsaized/ribbit) · [Native downloads](https://github.com/funsaized/ribbit/releases)

The latest published preview is **0.1.0-alpha.2**. Checkout documentation also covers [unreleased changes](CHANGELOG.md#unreleased), including updated inspection syntax, conditional capabilities and fixture diagnostics. These changes are not yet in the npm alpha or published native archives.

## Why I built this

I kept asking frontier models to do work my shell already does well: read a failure, gather the surrounding context, and sort the reports. Most of that work was exact: parsing, selecting, validating known procedures... only the interpretation needed a model. I wanted code for the exact parts, models for the interpretation, and something useful on the machine I actually have: a **12 GB RTX 3080 Ti**. I knew it had to be extensible and give agents a way to both run framework commands as well as build new features into Ribbit's core itself. Ribbit started as the invocations I kept reusing, then turned them into named commands and reusable flows. That is the motivation. Engineer everything. Assume nothing.

## Install and run

```sh
npm install -g @funsaized/ribbit@alpha
ribbit --help
```

```sh
ollama pull qwen2.5:3b
ribbit providers add local --type ollama --base-url http://127.0.0.1:11434 \
  --default-model qwen2.5:3b --capabilities object

printf '%s\n' \
  '{"ticket":"R1","body":"SAVE10 causes a payment error; retrying without the code works."}' \
  '{"ticket":"R2","body":"URGENT: Help page screenshot says Payment failed, but live payments work."}' \
  '{"ticket":"R3","body":"Screen reader users cannot focus the Pay button; mouse checkout works."}' \
  '{"ticket":"R4","body":"Card is charged and order completes, but confirmation emails arrive 20 minutes late."}' \
  '{"ticket":"R5","body":"Receipts say Shippng; support marked this high priority."}' |
  ribbit classify --input jsonl --field body \
    --label 'blocking=Prevents some customers from completing a purchase' \
    --label 'follow-up=Purchase completes, but another function is broken' \
    --label 'cosmetic=Wording or appearance only' --provider local |
  ribbit select 'ticket,label=$.annotations.classify.label' --output jsonl
```

**Example output** (labels are model judgments; check them against the original tickets):

```json
{"ticket":"R1","label":"blocking"}
{"ticket":"R2","label":"cosmetic"}
{"ticket":"R3","label":"blocking"}
{"ticket":"R4","label":"follow-up"}
{"ticket":"R5","label":"cosmetic"}
```

Install and start [Ollama](https://ollama.com/download) first (`ollama serve` if it is not already running). Ribbit sends each ticket to your local model, keeps the originals in its record stream, and projects the labels only at the end. For other models or endpoints, see [model setup](docs/how-to/configure-models.md). npm needs Node.js >=20 and tar; it installs the matching checksum-verified GitHub asset. Linux, macOS, and Windows, on x64 and ARM64. See [installation](docs/installation.md) for platform details.

## Three guided examples

- **Investigate a failing CI check** — [guide](docs/how-to/investigate-failing-ci.md). A deliberately broken [demo branch](https://github.com/funsaized/ribbit/commit/736583fd7a27dd9090ea3ebef358d864dcc3b256) has a [failed check](https://github.com/funsaized/ribbit/actions/runs/36018875927). Read its saved log, diff, and source excerpt into bounded evidence, then route a model to a schema-constrained diagnosis.
- **Prepare a date-fns contribution brief** — [guide](docs/how-to/handoff-date-fns.md). Select pinned repository files from a bounded offline fixture exactly, then annotate a brief with a local model while keeping the source excerpts.
- **Analyze an open dataset** — [guide](docs/how-to/analyze-open-data.md). Normalize the Central Park Squirrel Census, select nonempty notes exactly, and annotate a small deterministic sample. The offline sample is synthetic; live acquisition is a separate, non-transactional step.

## Composition

Ribbit gives each step an inspectable contract, an explicit model route, and a record format that carries IDs, source references, and annotations. Text and JSONL flow through ordinary pipes; a useful invocation can become a named YAML command, then a reusable flow. Exact commands such as `select`, `sort`, `where`, and `take` run without inference, and semantic commands use the profile you choose. There are 23 built-ins; [browse the command reference](docs/commands.md).

## Model arrangements

- **Exact preprocessing → local quantized instruct model.** Filter and project with exact commands, then let a small local model label or classify.
- **Exact context selection → hosted coding or reasoning model.** Gather real source with `find` and `read`, then hand the records to a stronger hosted model.
- **Local annotations → frontier review.** Annotate locally but keep every original, so a stronger model can challenge a bad label.
- **One capable model behind a reusable command.** Skip chaining entirely when one model with good defaults is enough.

Chaining is optional and is not automatically cheaper, faster, or better; a direct stronger-model request is a fair comparison. Native Ollama and tested OpenAI-compatible endpoints are supported, routes stay explicit, and there is no automatic cloud fallback.

## Extend it in TypeScript

Extensions share the same typed contracts as built-ins. A cloned directory installs with `ribbit extensions add PATH`, so one typed implementation can be reused from commands and flows. Follow [add a typed extension](docs/how-to/build-extension.md), or read the worked, read-only [GitHub PR evidence extension](examples/extensions/gh-evidence/README.md).

## What else could you build?

| Input | Output |
| --- | --- |
| Incident logs | A timeline and operations handoff |
| Merged changes | Linked release notes |
| Dependency changes | An upgrade brief |
| Support reports | Classifications that retain the originals |
| Meeting notes | Decisions and unresolved owners |
| Experiment results | A written summary |
| Research documents | Structured extraction |
| Local repository evidence | An agent handoff |

## Trust and initial evaluations

Contracts validate structure and selected invariants, not truth. Models vary, so keep originals where the documentation says they are retained. Extensions are trusted code: their declared effects are not permissions, and checking or installing one can execute it. Records do not prevent prompt injection, remote profiles receive the evidence you send, and there is no automatic cloud fallback. Read [execution and trust](docs/explanation/trust.md) and [platform support](docs/installation.md#platform-support).

The native CI matrix tests commands, recipes, installed archives, and npm installation on all six targets. The [initial evaluations](docs/models.md) report both successes and failures; chaining did not automatically make those fixtures faster or cheaper.

## Contribute

Read the [product requirements](Ribbit-PRD.md), [contributor guide](CONTRIBUTING.md), and [development guide](docs/development.md). The [documentation hub](docs/index.md) separates tutorials, how-to guides, reference, and explanation.

MIT licensed. The repository is `ribbit`; the product and command are **Ribbit / `ribbit`**. Report vulnerabilities through the [security policy](SECURITY.md).
