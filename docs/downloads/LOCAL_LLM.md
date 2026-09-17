# Local inference on this Mac Studio: Qwen and Gemma

This document updates the deployment and model choices in all five guides. Use the already installed Ollama models for actual inference. Keep mock banking endpoints and deterministic model fixtures for API regression tests. Opus 5 remains the coding agent used to build the demos.

## Verified local inventory

On 2026-09-17, the Mac's Ollama API at `http://127.0.0.1:11434` returned these installed models:

| Exact model tag | Intended demo role | Status |
| --- | --- | --- |
| `qwen-dev:latest` | Structured action planning and engineering responses | Installed; Qwen2-family 32.8B, Q4_K_M; advertised capability `completion` |
| `gemma3:12b` | FAQ responses and evidence-grounded summaries | Installed; advertised capabilities `completion`, `vision` |
| `gemma3:27b` | Optional larger summary model for comparison | Installed; performance/capabilities need a separate check |
| `embeddinggemma:latest` | Optional custom local semantic-cache embeddings | Installed; outside the core demo |
| `shieldgemma:2b` | Optional content moderation experiment | Installed; not a replacement for Model Armor's injection screening |

An additional SEA-LION Gemma model is installed but is not needed for these demos. Model installation does not prove tool-calling quality or useful latency; benchmark the selected tasks before presenting.

The inspected Qwen and Gemma 12B configurations do not advertise native tool calling. Therefore use the JSON planner below by default. Do not send a `tools` array to Ollama and assume it will work. Preserve the higher-level tool registry in the application; only the model adapter changes.

Two direct inference smoke checks also passed during preparation: Qwen returned the schema-constrained object `{"action":"list_cards"}` with `done:true`, and Gemma 12B returned a complete one-sentence banking explanation. Both reported prompt and completion token counts. This verifies basic API/format compatibility, not the unbuilt banking workflows or the planner's reliability on every task.

## Recommended model mapping

| Demo stage | Model | Application responsibility |
| --- | --- | --- |
| Banker tool planning | qwen-dev:latest | Validate proposal, permissions, and confirmation |
| Treasury scenario extraction | qwen-dev:latest | Calculate all cash figures in the mock backend |
| Treasury explanation | gemma3:12b | Give it only the computed forecast and source IDs |
| Fraud brief | gemma3:12b | Pre-fetch authorized evidence; validate citations |
| Marketplace tool planning | qwen-dev:latest | Discover tools, execute MCP, preserve partner identity |
| Public FAQ / document summaries | gemma3:12b | Restrict inputs and normalize output |
| Engineering explanation | qwen-dev:latest | Bound prompt size and output tokens |

For the model-switch demo, public FAQ can fall back from Gemma to Qwen, and engineering text can fall back from Qwen to Gemma. This proves route/fallback behavior between models on one host. It does not provide resilience against failure of the Mac, Ollama process, power, or internet connection. Do not use Gemma as a tool-planning fallback until it passes the same schema and authorization tests.

## Configuration to implement

```dotenv
MODEL_MODE=ollama
MODEL_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
MODEL_ID=qwen-dev:latest
PLANNER_MODEL=qwen-dev:latest
SUMMARY_MODEL=gemma3:12b
FAQ_MODEL=gemma3:12b
FALLBACK_MODEL_PROVIDER=ollama
FALLBACK_MODEL_ID=gemma3:12b
TOOL_CALLING_MODE=json_plan
MODEL_REQUEST_TIMEOUT_MS=45000
MODEL_FALLBACK_TIMEOUT_MS=30000
MODEL_TOTAL_DEADLINE_MS=80000
AGENT_RUN_TIMEOUT_MS=300000
OLLAMA_NUM_CTX=8192
OLLAMA_NUM_PREDICT=512
OLLAMA_KEEP_ALIVE=5m
```

Per-route configuration determines the fallback direction; the generic fallback variable alone does not override that table. In Docker Desktop on macOS, set `OLLAMA_BASE_URL=http://host.docker.internal:11434` inside containers. In a process running directly on the Mac, use loopback. Configure PostgreSQL for this project on host port `55432` because a PostgreSQL service already listens on `5432`.

Do not change the user's Ollama service settings or download/replace models automatically. Use per-request options. Start with one inference request at a time to avoid unpredictable model loading and memory contention. Measure warm-up and generation durations before increasing concurrency.

## Direct curl checks against the real installed models

These endpoints already exist on the Mac and are independent of the future banking mock application:

```bash
curl --fail-with-body -sS http://127.0.0.1:11434/api/tags | jq '.models[].name'
curl --fail-with-body -sS http://127.0.0.1:11434/api/show \
  -H 'Content-Type: application/json' -d '{"model":"qwen-dev:latest"}' | jq '.capabilities'
curl --fail-with-body -sS http://127.0.0.1:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemma3:12b","stream":false,"messages":[{"role":"user","content":"Explain in one sentence why a bank asks for confirmation before freezing a card."}],"options":{"temperature":0,"num_predict":96},"keep_alive":"5m"}' \
  | jq '{model,text:.message.content,input_tokens:.prompt_eval_count,output_tokens:.eval_count}'
```

Use [the local-model Postman collection](postman/00-local-ollama.postman_collection.json) for equivalent requests. Set its `ollama_url` environment value to loopback. Native Ollama `POST /api/chat` supports non-streaming output and reports prompt/completion counts. [Chat API](https://docs.ollama.com/api/chat).

## Adapter mapping

Implement an `OllamaAdapter` behind the existing normalized `/ai/v1/generate` contract. Mapping:

| Normalized field | Ollama native API |
| --- | --- |
| Approved model route | `model` set by trusted server configuration |
| `messages` for ordinary chat | `messages`, adapting unsupported role combinations |
| `max_output_tokens` | Bounded `options.num_predict` |
| `stream:false` | `stream:false` |
| Desired JSON schema | `format` with the schema |
| Text answer | `message.content` |
| Input token usage | `prompt_eval_count` |
| Output token usage | `eval_count` |
| Load/generation timing | Duration fields converted from nanoseconds to milliseconds |

Map Ollama error JSON and HTTP failures to the shared error contract. Require `done:true` for a complete non-streaming result. Incomplete output, parse failure, or truncation is not a successful tool decision. Do not estimate token usage by counting words when Ollama supplies actual counts. [Native API reference](https://docs.ollama.com/api/chat).

Never expose a model's hidden reasoning field in the evidence panel. Show the selected action, returned evidence, and timings. Keep provider-specific role/template handling inside the adapter; do not assume a custom Qwen template or Gemma accepts every chat role unchanged.

## JSON planning instead of native tool calling

For agent steps, convert the authorized tool registry to a constrained output schema. The plan is exactly one of:

```json
{"kind":"tool_call","tool_name":"list_cards","arguments":{}}
```

```json
{"kind":"final","text":"I found your card ending in 4242. Please confirm before it is frozen."}
```

Build a JSON Schema with a final-answer branch plus one branch per authorized tool. Each tool branch constrains `tool_name` and uses that tool's exact input schema. Reject additional properties. Send a concise instruction containing the authorized tool descriptions and the same schema as the Ollama `format`. Structured output is a formatting aid; validate every response independently. [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs).

For the installed models, serialize tool results as clearly delimited data in a supported chat role rather than relying on native `tool` messages. Retain provenance and never treat retrieved text as new system instructions. The loop then:

1. Parses the returned JSON strictly; no `eval`, code execution, or automatic arbitrary code-fence extraction.
2. Validates its schema and tool name against the current identity's registry.
3. Converts a valid plan to the normalized `tool_calls` response expected by the shared agent loop, assigning a server-generated call ID.
4. Executes through Apigee, appends the structured result, and asks for the next plan.
5. Stops for a human confirmation or returns the final answer when appropriate.

Allow at most one repair request for malformed JSON. If repair fails, return `422 MODEL_OUTPUT_INVALID` with a user-friendly message and no bank mutation. Never downgrade to parsing natural-language instructions as executable actions. Keep all shared round, tool, and time budgets.

For treasury and fraud, prefer a deterministic retrieval/calculation workflow followed by a grounded Gemma summary when free-form planning adds no value. This still uses real local inference while keeping the banking computations testable.

## Connecting real cloud Apigee to the Mac

Cloud Apigee cannot call `127.0.0.1` on this Mac. Pick one of these explicit topologies:

| Topology | Network path | Meaning |
| --- | --- | --- |
| Local development | curl/Postman → simulator → local mocks/Ollama adapter | No real Apigee enforcement |
| Preferred leadership demo | curl/Postman or local BFF → cloud Apigee → authenticated HTTPS demo bridge → local mock bank/model adapter → Ollama | Real Apigee, real local models, synthetic bank |
| Existing private connectivity | Apigee → approved private route/VPN → authenticated bridge on Mac | Use only if the route already exists or is provisioned separately |

For the leadership topology, implement a `services/demo-bridge` reverse proxy bound to `127.0.0.1:8090`. Use an organization-approved HTTPS tunnel/relay to reach that port. The implementer supplies its actual hostname and credentials; do not invent a reachable URL or make an unauthenticated public Ollama endpoint.

Bridge route allowlist:

- `/bank/v1/*` → local mock bank service.
- `/ai/v1/*` → local model/screening adapter.
- `/tools/partners/mcp` and, if implemented, `/tools/retail/mcp` → local MCP adapter; preserve negotiated MCP headers. Omit these bridge routes when native Apigee MCP needs no local adapter.
- `/internal/events` → authenticated evidence ingestion.
- `/demo-identity/.well-known/jwks.json` → public signing keys only; read-only exception.

All non-JWKS routes require a high-entropy `X-Apigee-Bridge-Key` injected by Apigee from secret-backed configuration. Reject missing/wrong keys before forwarding. The bank still verifies the user JWT. Apigee strips any incoming bridge-key header before setting its own. The bridge enforces a body-size limit, request timeouts, explicit path/method allowlists, and no arbitrary upstream URLs. Tunnel/relay authentication may add another layer. Keep Ollama `/api/*`, model downloads, local admin/reset, and the presenter UI outside the bridge allowlist.

For `/ai/v1/usage`, route to the adapter's trusted usage-ledger handler. For MCP adapter mode, ensure its outbound bank calls use the cloud Apigee hostname so the banking operations still receive gateway enforcement; do not shortcut them to localhost bank routes.

Forward the external JWT unchanged. Configure issuer/JWKS consistently so Apigee can verify it via the publicly reachable keys endpoint. Publish only public keys there. Do not use the Cloud Run ID-token target configuration for a Mac bridge; that configuration in SHARED_PLATFORM applies only to Cloud Run targets.

Keep body streaming disabled initially. Set the proxy/bridge target deadline slightly above the adapter's total deadline, within the deployed Apigee environment's supported limits. Warm the model before the presentation; a cold 32B model may exceed a short timeout. Do not open a tunnel or change the existing Ollama listener as a side effect of running local tests.

Cloud Apigee and optional Model Armor process the traffic even though inference runs locally. Describe this as local model inference with cloud API governance, not an entirely offline or device-only data path.

## Screening and caching remain separate

Keep guide 03's deterministic fixture screening for local API tests. Use actual Model Armor for the real injection-screening demonstration when configured. The installed `shieldgemma:2b` focuses on content moderation categories; do not label it as equivalent to Model Armor or assume it detects data exfiltration/prompt injection. [ShieldGemma model card](https://ai.google.dev/gemma/docs/shieldgemma/model_card).

`embeddinggemma:latest` could power an optional custom semantic-cache service, but that would be application-owned caching behind Apigee. Native Apigee semantic caching remains the separate integration in guide 04. Local inference has hardware/operating costs; show token counts and latency without inventing per-token provider bills.

## Implementation acceptance

- Postman/curl can list installed models and obtain real Qwen and Gemma responses.
- Qwen produces a schema-valid plan and invalid output cannot trigger any tool.
- Actual `prompt_eval_count`/`eval_count` feed normalized usage and gateway accounting.
- Agent requests traverse the configured gateway; the browser never calls Ollama directly.
- A deliberate logical-model fault triggers a compatible fallback, without stopping the user's Ollama service.
- Mac/Ollama outage is reported honestly as a shared failure; no fabricated answer appears.
- Cloud Apigee can reach only the bridge's authorized routes with the correct service credential.
- Model status is `ollama/live`; bank status is `synthetic`; screening and gateway modes are separately visible.

## Additional instruction for Opus 5

```text
Use the existing Ollama service on the user's Mac Studio. Exact installed tags:
qwen-dev:latest, gemma3:12b, and optionally gemma3:27b. Use native /api/chat.
Implement the JSON planner because the inspected models do not advertise native
tools support. Keep deterministic model mocks for regression tests, but use
actual Ollama for the live demo. Do not install, replace, or reconfigure models.
Implement an authenticated demo bridge for a supplied HTTPS tunnel/private route
so cloud Apigee can reach the local services. Keep backend banking APIs synthetic.
Do not claim same-host fallback provides host-level availability.
```
