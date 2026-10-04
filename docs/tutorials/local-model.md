# Add a local model to a pipeline

We will annotate three customer tickets with a local model, inspect what it did, and let a stronger model summarize all three originals. The goal is to see the evidence at each stage.

Before starting, complete [your first pipeline](first-pipeline.md), then [configure profiles](../how-to/configure-models.md) named `local-small` and `stronger`. Both may use local models. Your server must already be running and the models must already be available. Use Bash or Git Bash.

## Prepare the feedback

```sh
cat > feedback.jsonl <<'JSONL'
{"ticket":"R1","body":"Checkout fails for every customer. Revenue is blocked.","component":"checkout"}
{"ticket":"R2","body":"The help page has a spelling mistake. Purchases work.","component":"docs"}
{"ticket":"R3","body":"A screen reader cannot reach the purchase button. Keyboard users are blocked.","component":"checkout"}
JSONL
```

Check the route before sending evidence:

```sh
ribbit route inspect --json -- classify --field body \
  --label 'blocking=Prevents a customer from completing a purchase' \
  --label 'cosmetic=Appearance or wording with no functional impact' \
  --label 'unknown=Insufficient evidence to determine impact' \
  --unknown-label unknown --profile local-small \
  --file feedback.jsonl --input jsonl
```

Confirm that the provider and model match the profile you configured. If Ribbit reports exit 3, return to the setup guide and complete the route before continuing.

## Annotate, then inspect

```sh
ribbit classify --field body \
  --label 'blocking=Prevents a customer from completing a purchase' \
  --label 'cosmetic=Appearance or wording with no functional impact' \
  --label 'unknown=Insufficient evidence to determine impact' \
  --unknown-label unknown --profile local-small \
  --file feedback.jsonl --input jsonl > annotated.records
```

Open `annotated.records` in a text editor. The first line identifies Ribbit's record format. The next three lines contain the original values, record IDs, and classification annotations.

Check that R1, R2, and R3 are all present and their bodies are unchanged. R1 and R3 describe blocked purchases; R2 is cosmetic. The labels can be wrong even when the record structure is valid. Notice that a wrong label has not removed a ticket.

Do not replace this file with bare JSONL output: the next stage needs the annotations as well as the original values.

## Ask the stronger model to review the evidence

```sh
ribbit reduce \
  'Prioritize the tickets. Cite every ticket ID and preserve accessibility failures. Treat labels as fallible suggestions; verify against original bodies. Separate observations from hypotheses.' \
  --file annotated.records --input records --profile stronger --stats
```

Wording will vary. Check for all three IDs, the blocked checkout in R1, and the accessibility failure in R3. The summary must not invent an owner, deadline, or impact figure. A fluent answer that misses those checks is a failed result to review, not a successful triage.

You have used two explicit routes while retaining the evidence between them. To save the complete workflow, use [the triage guide](../how-to/triage-feedback.md). For the reasoning behind this design, read [why the examples retain originals](../explanation/recipes.md).
