# Why the examples retain originals

The supplied examples demonstrate three different kinds of reuse. Their YAML is intentionally short; the important decisions concern what crosses each boundary.

## Feedback triage

Source: [triage.yaml](../../examples/flows/triage.yaml). Run it with [the triage guide](../how-to/triage-feedback.md).

| Step | Input and output | Why it exists |
| --- | --- | --- |
| `prepare`: select | Keeps `ticket`, `body`, and `component` | Makes the fields sent downstream explicit |
| `annotate`: classify | Adds a label to each original record through `local-small` | Gives the stronger model a fallible suggestion to inspect |
| `synthesize`: reduce | Receives all tickets plus annotations through `stronger` | Prioritizes with source IDs and checks labels against the original bodies |

There is no filter between classification and synthesis. R3's screen-reader failure must reach the final model even if the small model gives it a poor label. The reducer is instructed to preserve accessibility issues and cite all ticket IDs.

This design favors recall and review over context reduction. Labels increase the input size. The tests verify that all originals reach the reducer, while the live evaluation separately checks required facts in the answer. Neither check makes arbitrary model output trustworthy.

## Repository context

Source: [context.yaml](../../examples/flows/context.yaml). Run it with [the handoff guide](../how-to/handoff-context.md).

`find` gathers real files and content within an explicit traversal bound. `classify` adds relevance labels for session expiration and request authentication. The flow returns records instead of synthesizing a final answer.

That boundary lets an external harness inspect paths, text, and annotations together. Both `auth.ts` and `colors.ts` survive. The receiver can disagree with `other` or `relevant` because it still has the text that produced the label.

The path identifies where the evidence came from during this run. Copying the record file to another machine does not copy those source files or make their paths valid there. The text in each record is what the handoff actually carries.

## Reusable brief

Sources: [brief command](../../examples/commands/brief.yaml) and [brief flow](../../examples/flows/brief.yaml). Build it with [the reusable-command tutorial](../tutorials/reusable-command.md).

The named command reuses `@ribbit/summarize` with a 40-word default and a rule to preserve facts. The flow invokes that name, then rewrites the summary in plain language. A caller can override the word limit without changing the definition.

Unlike the other examples, this workflow deliberately compresses text. Once the summary omits a fact, rewriting cannot reconstruct it reliably. The [versioned rubric](../../evals/README.md#offline-factual-regrade-rubric-200) distinguishes an assigned reviewer from an unassigned one and **by Friday** from **on Friday**. It requires explicit source-grounded review of paraphrases; names and numbers appearing somewhere in the answer are not proof. Unreviewed prose stays pending.

The second step is optional for your own work. If the summary already has the wording you need, a named command alone avoids an extra model request.

## What the examples establish

Packaged tests check routes, metadata, identity, data boundaries, and shell/flow behavior using controlled responses. Live runs test the configured models on the fixture facts. The [current evaluations](../models.md) keep those two forms of evidence separate.
