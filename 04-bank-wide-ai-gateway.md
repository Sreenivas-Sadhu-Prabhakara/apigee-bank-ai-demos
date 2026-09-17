# 04 — Bank-wide AI gateway: routing, fallback, and token control

Build with [SHARED_PLATFORM.md](SHARED_PLATFORM.md). Import [the Postman collection](postman/04-bank-wide-ai-gateway.postman_collection.json). Mock model-provider endpoints are part of this demo and can be tested without buying model access.

For live inference, use [LOCAL_LLM.md](LOCAL_LLM.md): Gemma 12B for FAQ/document responses and Qwen for engineering/planning. Fallback between these models shares one Mac/Ollama failure domain. The provider mocks remain the deterministic regression mode.

## Outcome and scope

Three internal applications share an AI entry point. Show an approved model route, a simulated upstream failure followed by a successful configured fallback, and one app reaching its token allowance while another continues operating.

MVP: normalized non-streaming model API, two mock targets, real app/product permissions, token accounting, and an evidence dashboard. Live providers are the connected-demo extension. Native semantic caching is optional because it needs additional infrastructure.

## Actors and routing configuration

Scenario `gateway`. Credentials: `support_app`, `engineering_app`, `documents_app`. Each has a distinct verified `azp` and Apigee app key. Use synthetic user identities to retain the shared dual-auth contract.

| App | Permitted `use_case` | Logical primary | Logical fallback | Demo allowance |
| --- | --- | --- | --- | ---: |
| support_app | `public_faq` | `economy` | `economy_backup` | 1000 tokens per configured window |
| engineering_app | `code_help` | `reasoning` | `reasoning_backup` | 10000 |
| documents_app | `document_summary` | `reasoning` | None until explicitly configured | 10000 |

Logical names resolve to actual provider/model IDs in server deployment configuration. Do not embed a model identifier assumed to exist. App identity controls the route allowlist; a request body or `X-Model` header cannot enable an unapproved target. Fail over only between endpoints approved for that app's data classification.

For rehearsal use a short documented quota window, for example five minutes. For the collection's quota test, caching is explicitly disabled in the session fixture. Real Apigee counters are app scoped and are not cleared by resetting the mock bank session. Use a fresh designated demo app or wait for the configured window before a cloud rerun.

## Mock provider and public endpoint contracts

Implement these internal provider routes in `model-adapter`; access is limited to the gateway/internal routing service:

| Method and internal path | Normal behavior | Fault behavior |
| --- | --- | --- |
| `POST /mock-provider/primary/generate` | `200`, normalized model response | `503 UPSTREAM_UNAVAILABLE` when `primary_model_503` is enabled for the session |
| `POST /mock-provider/secondary/generate` | `200`, same fixture answer with `model:"mock-secondary"` | `503` when `secondary_model_503` is enabled |

Both accept the normalized model request in SHARED_PLATFORM. For the API collection, a plain single user message returns text with no tool calls and usage `{input_tokens:200,output_tokens:100}`. These counts are deterministic synthetic measurements. In other use cases, the mock may return scripted tool calls according to the specified scenario; keep those fixtures separate.

Fixture answers:

- `public_faq`: “In this synthetic bank, report a lost card through the app or contact the demo support team.”
- `code_help`: “Validate the request, use an idempotency key, and retry only operations that are safe to repeat.”
- `document_summary`: “The synthetic document describes customer authentication, service availability, and audit records.”

Public gateway endpoints:

| Method and path | Request | Response |
| --- | --- | --- |
| `POST /ai/v1/generate` | Shared normalized request | `200`, normalized model response plus gateway metadata below |
| `GET /ai/v1/usage` | No body; identity determines app | `200`, shared envelope containing that app's observed usage |

Add response metadata:

```json
{
  "gateway": {
    "app_id": "support-app",
    "selected_route": "economy",
    "fallback_used": false,
    "cache_status": "BYPASS",
    "usage_source": "synthetic",
    "attempts": [{"target":"mock-primary","status":200,"elapsed_ms":25}]
  }
}
```

`/usage` data is `{app_id,window_start,window_end,observed_input_tokens,observed_output_tokens,observed_total_tokens,configured_allowance_tokens,usage_source}`. The ledger is built from trusted adapter/gateway events. It is an observability view, not a claim to expose Apigee's internal distributed quota counter. Document any ingestion lag.

Faults: unsupported use case → `403 MODEL_ROUTE_NOT_ALLOWED`; quota exhaustion → `429 TOKEN_QUOTA_EXCEEDED`; invalid input → `422 INVALID_MODEL_REQUEST`; both permitted targets unavailable → `503 MODEL_UNAVAILABLE`. Fault responses preserve trace ID and a safe retry indication.

## Implement routing and fallback precisely

Apigee selects a logical route from verified app configuration using conditional routing or trusted flow variables. The target is a model-adapter endpoint for that approved route. The adapter normalizes provider requests and handles bounded runtime fallback; label fallback events `component:model-adapter`. Apigee routing is native gateway behavior, while this MVP's cross-provider retry orchestration is application code. [Apigee route behavior](https://docs.cloud.google.com/apigee/docs/api-platform/fundamentals/understanding-routes).

Algorithm:

1. Validate app, use case, request schema, and output limit; select an allowed route.
2. Call primary with an eight-second timeout in mock mode. For the live Mac models, use the explicit primary/fallback/total time budgets in LOCAL_LLM and warm the models before presenting.
3. Retry once on the approved secondary for a connection failure, timeout, or upstream `502/503/504`, provided no response has been sent to the client.
4. Never fall back on gateway denial, exhausted quota, invalid input, or screening block. Do not retry bank mutations through this mechanism.
5. Return only the successful response, together with redacted attempt metadata. If both fail, return `503`; do not substitute an invented answer.

Use `stream:false` for the MVP so retry behavior is unambiguous. A timed-out provider may still have processed a request or charged tokens. Record unknown usage honestly; do not report unknown cost as zero. Streaming and a distributed circuit breaker are optional future increments.

## Token policy design

In Apigee request flow, apply identity/product checks, `PromptTokenLimit` as an input-token-rate control, then `LLMTokenQuota` in enforcement mode. After provider normalization, use response token usage for accounting with `LLMTokenQuota` in counting mode. Match app/model/operation identifiers and shared counter configuration for enforcement and accounting, following the current policy reference. [Token policy tutorial](https://docs.cloud.google.com/apigee/docs/api-platform/tutorials/using-ai-token-policies).

For Qwen/Gemma, explicitly compute a trusted `demo.tokens_used` variable from normalized input plus output counts and point `LLMTokenUsageSource` to it. The default extraction expects a different provider schema. Use the verified app identity as `Identifier` and the same `SharedName` for counting/enforcement. Keep the app budget shared across primary/fallback models so switching targets cannot reset its allowance. Map `LLMModelSource` explicitly and validate the chosen counter configuration with both model routes. Input-token-rate estimates are separate from Ollama's reported actual counts. The current reference lists this policy for Apigee, not Apigee hybrid; record target-environment support before building. [Quota policy reference](https://docs.cloud.google.com/apigee/docs/api-platform/reference/policies/llm-token-quota-policy).

The policy does not create an exact prepaid monetary balance. Completion usage is known after a call, and concurrent/in-flight calls can overshoot. In the deterministic simulator, allow a request while recorded usage is below the allowance and account for it afterward: with 300-token calls and a 1000-token allowance, calls 1–4 succeed and call 5 returns `429`. For actual Apigee, test eventual enforcement and isolation rather than promising that exact count.

Support output-token caps per request. Preserve usage for every provider attempt when known. Missing usage must be recorded as unknown or explicitly estimated; never fabricate provider-reported values. If a strict spend ceiling is later required, add a reservation/settlement budget service as separate work.

Display tokens directly. Show estimated monetary cost only when the implementer supplies dated price configuration and distinguishes estimates from provider billing.

## Optional semantic cache extension

First pass all routing/quota tests with caching disabled. Add caching only for `public_faq` inputs explicitly classified as public, non-personal, and grounded in the versioned FAQ fixture.

Native semantic caching requires `SemanticCacheLookup`, `SemanticCachePopulate`, embeddings, and Vector Search configuration. Partition by product/knowledge version, language, model/prompt version, and relevant authorization context. TTL is five minutes for the demo. Do not cache balances, customer conversations, tool calls, investigation content, approvals, or payment decisions. [Native caching setup](https://docs.cloud.google.com/apigee/docs/api-platform/tutorials/using-semantic-caching-policies).

Apply authentication and request screening before lookup. On a hit, return only a screened, eligible stored answer; retain model-version provenance. Mark `cache_status:HIT`, report zero new provider tokens, and do not count the original generation usage again. A local exact-match cache, if implemented, must be labeled `EXACT_MATCH_SIMULATOR`, not semantic caching.

## Curl walkthrough

```bash
export HARNESS_URL=http://localhost:8080
export GATEWAY_URL=http://localhost:8088
session_json=$(curl --fail-with-body -sS -X POST "$HARNESS_URL/demo/v1/sessions" \
  -H "X-Demo-Admin-Key: $DEMO_ADMIN_KEY" -H 'Content-Type: application/json' -d '{"scenario":"gateway"}')
session_id=$(jq -r '.session_id' <<< "$session_json")
support_token=$(jq -r '.credentials.support_app.access_token' <<< "$session_json")
support_key=$(jq -r '.credentials.support_app.api_key' <<< "$session_json")
faq_body='{"use_case":"public_faq","messages":[{"role":"user","content":"How do I report a lost card?"}],"tools":[],"max_output_tokens":200,"stream":false}'
curl --fail-with-body -sS -X POST "$GATEWAY_URL/ai/v1/generate" \
  -H "Authorization: Bearer $support_token" -H "x-api-key: $support_key" \
  -H 'Content-Type: application/json' -d "$faq_body" | jq
curl --fail-with-body -sS -X POST "$HARNESS_URL/demo/v1/sessions/$session_id/faults" \
  -H "X-Demo-Admin-Key: $DEMO_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"fault":"primary_model_503","enabled":true}' | jq
curl --fail-with-body -sS -X POST "$GATEWAY_URL/ai/v1/generate" \
  -H "Authorization: Bearer $support_token" -H "x-api-key: $support_key" \
  -H 'Content-Type: application/json' -d "$faq_body" | jq '.gateway'
# Expected fallback_used:true and primary 503 / secondary 200 attempts.

# Repeat a bounded number of times to observe 429; stop at the first denial.
for attempt in 1 2 3 4 5 6 7 8; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$GATEWAY_URL/ai/v1/generate" \
    -H "Authorization: Bearer $support_token" -H "x-api-key: $support_key" \
    -H 'Content-Type: application/json' -d "$faq_body")
  echo "attempt=$attempt status=$status"
  if [ "$status" = 429 ]; then break; fi
done
curl --fail-with-body -sS "$GATEWAY_URL/ai/v1/usage" \
  -H "Authorization: Bearer $support_token" -H "x-api-key: $support_key" | jq
```

The collection then calls engineering and document applications successfully, tests forbidden routing, and checks a two-target outage. Native quota timing can differ; its local fixture assertions are mode-aware.

## Build order and acceptance

1. Implement both provider mocks, fault injection, normalized requests/responses, and the usage ledger.
2. Implement simulator app permissions and post-response quota counting; pass API checks.
3. Build the three-app dashboard and evidence panel with real measured durations.
4. Configure actual Apigee routing and token policies. Test with mocks first, then live models.
5. Add native semantic caching only after the core demonstration works.

Acceptance: support cannot request reasoning routes; primary fault produces one approved fallback; both failed targets produce `503`; quota denial never triggers fallback; another app remains usable; no internal header can override model selection; unknown usage is explicit; cache hits, if enabled, do not replay personal data or duplicate generation accounting.

## Five-minute presentation

Run one request per app → open the route and token panel → inject primary failure → show approved secondary answer and attempt trace → exhaust support allowance → show engineering still works → optionally ask a paraphrased public FAQ and demonstrate a measured native cache hit.

## Opus 5 build prompt

```text
Implement demo 04 and the shared foundation. Begin with two deterministic mock
provider endpoints and make the supplied Postman flow pass without model keys.
Implement verified-app routing, bounded non-streaming fallback, honest token
accounting, usage isolation, and fault injection. Add Apigee token policies and
route bundles with actual documentation-verified syntax. Keep native gateway
behavior separate from adapter fallback and local simulation in the UI.
Do not claim a hard monetary cap or zero cost for an unknown provider attempt.
Semantic caching is optional and must not delay the core routing/quota demo.
```
