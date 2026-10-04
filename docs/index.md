# Model tasks that work like commands

Ribbit is an extensible framework for composing model tasks into reusable commands, with typed contracts and inspectable evidence. It reads UTF-8 text, JSON values, JSONL, files, and tool output. Keep the evidence, choose a route for each semantic step, and pass the result to another command or a coding harness.

These docs describe the source checkout. The latest published preview is **0.1.0-alpha.2**; the [unreleased changelog](../CHANGELOG.md#unreleased) lists changes not yet in the npm alpha or published native archives.

**New to Ribbit? Start with [your first pipeline](tutorials/first-pipeline.md).** It needs no model, account, or provider configuration.

| What you need | Where to go |
| --- | --- |
| Learn by building something small | [Tutorials](tutorials/index.md) |
| How do I do...? | [How-to guides](how-to/index.md) |
| Look up syntax, formats, or limits | [Reference](reference/index.md) |
| Understand Ribbit's core | [Explanation](explanation/index.md) |

## Try a workflow

- [Prioritize customer feedback](how-to/triage-feedback.md): classify locally, then synthesize with a stronger model.
- [Prepare repository context for a harness](how-to/handoff-context.md): retain source text and attach relevance labels.
- [Investigate a failing CI check](how-to/investigate-failing-ci.md): interpret a controlled offline failure from saved evidence.
- [Prepare a date-fns contribution brief](how-to/handoff-date-fns.md): pin repository sources, then annotate a brief locally.
- [Analyze an open dataset](how-to/analyze-open-data.md): normalize, select, and annotate a small deterministic sample.
- [Save a useful transformation](tutorials/reusable-command.md): turn a command into a named definition and a flow.

Install from [npm](https://www.npmjs.com/package/@funsaized/ribbit) or a [native GitHub archive](https://github.com/funsaized/ribbit/releases). See [installation](installation.md) for prerequisites and platform support.

Ribbit is an MIT-licensed alpha. Semantic results depend on the model; the [current evaluations](models.md) show both passing and failing cases. Linux, macOS, and Windows have native x64/ARM64 builds. Interactive Windows picking remains separately unverified.

These docs use [Diátaxis](https://diataxis.fr/): lessons, task guides, technical reference, and explanations are separate so you can find the kind of help you need.
