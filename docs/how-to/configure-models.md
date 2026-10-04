# Configure model routes

Use this guide to connect an existing local endpoint and name the models that commands should use. Ribbit does not download models or start their servers.

## Connect the endpoint

For LM Studio or another local OpenAI-compatible server, start its HTTP service, then register it:

```sh
ribbit providers add local --type openai-compatible \
  --base-url http://127.0.0.1:1234/v1 \
  --capabilities text,stream,object,temperature,maxOutputTokens
ribbit models list --provider local
```

Use the server's actual base URL if it differs. Declare only the capabilities your endpoint supports. An OpenAI-compatible label does not guarantee every server implements the same features.

For native Ollama, register its protocol instead:

```sh
ribbit providers add local --type ollama \
  --base-url http://127.0.0.1:11434 \
  --capabilities text,stream,object,temperature,maxOutputTokens,reasoning
ribbit models list --provider local
```

Choose one registration for the name `local`. Use a different provider name if you need both.

## Name the routes

Replace the model placeholders with exact identifiers returned by your endpoint:

```sh
ribbit profiles set local-small --provider local --model YOUR_SMALL_MODEL --max-output-tokens 2048
ribbit profiles set stronger --provider local --model YOUR_STRONGER_MODEL --max-output-tokens 2048
ribbit route inspect --json -- classify --labels blocking,cosmetic,unknown --profile local-small
ribbit route inspect --json -- reduce 'Summarize the supplied evidence' --profile stronger
ribbit doctor --json --probe -- reduce 'Summarize the supplied evidence' --profile stronger
```

Inspection parses the invocation but reads no task input and contacts no provider. Scoped doctor checks this route; `--probe` explicitly lists its models without performing inference. Plain `doctor` can report a missing default route even when these explicitly selected profiles work.

The names describe roles in a workflow, not a guarantee about model quality. Both profiles may point to local models; while learning, they may point to the same model. Check the [model evidence](../models.md) before relying on a small model for filtering or grouping.

Test a bounded request:

```sh
printf 'Mina owns the checkout fix.\n' |
  ribbit ask 'Who owns the fix?' --profile local-small --stats
```

The answer should name Mina. Inspect failures with the [troubleshooting guide](troubleshoot.md).

## Configure a remote endpoint deliberately

Use `--api-key-env NAME` to reference a credential already present in your environment. Do not put the key in a provider URL, YAML file, or shell argument. For example, once `PROVIDER_API_KEY` is set securely:

```sh
ribbit providers add remote --type openai-compatible \
  --base-url https://YOUR_PROVIDER/v1 --api-key-env PROVIDER_API_KEY \
  --capabilities text,stream,object,temperature,maxOutputTokens
```

A route to this provider sends the supplied evidence to that endpoint. Ribbit never chooses it as an automatic fallback.

For configuration locations, defaults, precedence, and reasoning controls, see [configuration reference](../reference/configuration.md). To apply the profiles to steps, continue with [mixed-model routing](route-workflows.md).
