# Shared implementation foundation

Read this before any numbered guide. Requirements here apply to all five demos. The repository layout and commands are a target for the coding agent to implement, not files or commands already present in this documentation pack.

Selected model runtime: the user's existing local Qwen/Gemma models. Read [LOCAL_LLM.md](LOCAL_LLM.md) for the exact tags, JSON planner, timing settings, and Mac-to-Apigee bridge. Its local deployment instructions take precedence over the optional Cloud Run topology below.

## 1. Architecture and ownership

```mermaid
flowchart LR
    UI[React demo UI] --> BFF[Session API and agent loop]
    BFF --> GW[Apigee: banking and model proxies]
    GW --> BANK[Synthetic banking API]
    GW --> MODEL[Model adapter and fallback service]
    MODEL --> LLM[Configured model providers]
    GW --> ARMOR[Model Armor where enabled]
    BANK --> DB[(PostgreSQL)]
    BFF --> DB
    GW -. gateway events .-> EVENTS[Evidence collector]
    BANK -. backend events .-> EVENTS
    MODEL -. model events .-> EVENTS
    EVENTS --> BFF
```

Apigee authenticates applications and users, applies API/tool permissions and traffic policies, selects approved model routes, and records gateway decisions. Application code owns the agent loop, domain calculations, consent, approval state, idempotency, and UI. The model proposes tool calls and explains returned evidence. It cannot approve its own actions or determine account ownership.

For the local mode, a small HTTP gateway simulator occupies the same network position. It is a contract-compatible test component, not an Apigee emulator. Mark every event it emits `enforcer: gateway-simulator`.

## 2. Opinionated implementation stack

Use TypeScript throughout: React with Vite for the UI; Fastify for HTTP services; Zod or an equivalent schema library at boundaries; PostgreSQL for all durable state. Use the current supported Node.js LTS at implementation time and pin the actual chosen versions and lockfile. Use a single bounded agent loop rather than a multi-agent framework.

Use Docker Compose locally and Cloud Run plus managed PostgreSQL for the cloud demo. PostgreSQL must hold approvals, idempotency records, events, and demo state; Cloud Run's local filesystem is not durable storage. The UI can be served by the BFF to keep browser requests same-origin.

```text
apps/
  web/                      # Five routes, presenter controls, evidence panel
  server/                   # Browser sessions, agent loop, human actions, SSE
services/
  bank-api/                 # Synthetic banking behavior and calculations
  model-adapter/            # Provider normalization; optional bounded fallback
  gateway-simulator/        # Local mode only
  mcp-adapter/              # Only if native MCP is unavailable
  evidence-collector/       # Authenticated event ingestion and scoped reads
packages/
  contracts/                # OpenAPI, tool schemas, runtime validation
  identity/                 # JWT verification and demo issuer helpers
  fixtures/                 # Versioned seeds and deterministic model scenarios
  agent/                    # Tool dispatcher and bounded loop
apigee/
  proxies/{bank-v1,ai-v1,mcp-retail,mcp-partners}/apiproxy/
  products/                 # Product definitions; no credentials
infra/                      # Compose, Cloud Run and database setup scripts
tests/{unit,integration,e2e,cloud}/
docs/{deployment,capabilities,presenter}/
```

Implement only the services needed by the selected guide. A REST tool dispatcher is sufficient for demos 01–04 initially; demo 05 requires MCP. Native MCP can be added to demo 01 as its final integration step.

## 3. Developer interface and configuration

Supply these root scripts:

```bash
npm ci
npm run infra:up
npm run db:migrate
npm run demo:seed
npm run dev
npm run check
npm run test:integration
npm run test:e2e
npm run apigee:validate
npm run apigee:package
```

`infra:up` starts local PostgreSQL; `dev` starts the selected app/services. `check` runs type checking and relevant unit checks. `apigee:validate` performs XML, policy-reference, and contract checks locally; report that deployment acceptance still requires Apigee. `apigee:package` creates importable ZIPs with an `apiproxy/` root. Implement cloud deployment and smoke-test scripts separately; do not silently provision paid infrastructure during a local command.

Default local ports: UI/BFF `8080`, bank API `8081`, model adapter `8082`, optional MCP adapter `8083`, evidence collector `8084`, gateway simulator `8088`. Internal services are bound to loopback or an internal Compose network.

Create `.env.example` documenting these inputs:

```dotenv
DEMO_MODE=local
ENABLED_DEMOS=banker,treasury,fraud,gateway,marketplace
GATEWAY_BASE_URL=http://localhost:8088
MODEL_MODE=mock
SCREENING_MODE=mock
MCP_MODE=adapter
DATABASE_URL=postgresql://demo:local-demo-only@localhost:55432/bank_demo
DEMO_AS_OF_DATE=2026-09-14
DEMO_TIMEZONE=UTC
DEMO_JWT_ISSUER=http://localhost:8080/demo-identity
DEMO_JWT_AUDIENCE=bank-ai-demo
DEMO_JWKS_URL=http://localhost:8080/demo-identity/.well-known/jwks.json
PRESENTER_PASSWORD=
DEMO_ADMIN_KEY=
MODEL_PROVIDER=
MODEL_ID=
FALLBACK_MODEL_PROVIDER=
FALLBACK_MODEL_ID=
GOOGLE_CLOUD_PROJECT=
GOOGLE_CLOUD_REGION=
APIGEE_ORG=
APIGEE_ENV=
APIGEE_HOSTNAME=
MODEL_ARMOR_TEMPLATE=
```

Add service URLs, database secrets, and individual Apigee app credentials as documented deployment inputs. Keep them server-side, out of source control and browser bundles. Cloud mode must reject empty secrets and local default passwords. Never assume a model named "Opus 5" is available through a runtime API: select the actual provider/model ID supplied by the implementer.

## 4. Identity contract

Create a presenter-authenticated demo session. Persona switching is a presenter operation on synthetic identities, not a public impersonation API. In cloud mode protect the presenter UI with authentication and HTTPS. Use secure, HttpOnly session cookies; apply CSRF/origin protection to human confirmation and admin routes.

Issue short-lived RS256 demo JWTs from a server-held key and publish only the public JWKS. This issuer is explicitly a demonstration identity service; a real bank would connect its existing identity provider. Check signature, issuer, audience, expiration, and permitted algorithms in both Apigee and the banking backend.

Example claims, with temporal claims generated at runtime:

```json
{
  "iss": "https://demo.example/demo-identity",
  "aud": "bank-ai-demo",
  "sub": "customer-001",
  "azp": "retail-assistant",
  "tenant_id": "retail-demo",
  "scopes": ["accounts:read", "cards:read", "cards:freeze", "disputes:prepare"],
  "roles": ["customer"],
  "demo_session_id": "session-generated-at-login"
}
```

The BFF sends `Authorization: Bearer <user-jwt>` and `x-api-key: <server-held-app-key>` to Apigee. Use `VerifyAPIKey` for the registered app/product and `VerifyJWT` for user claims. Bind verified `azp` to the verified app's configured client ID. Require both product permission and user scope. Do not use `OAuthV2 VerifyAccessToken` as a generic verifier for arbitrary externally issued JWTs.

Strip caller-supplied internal identity, selected-model, policy-decision, and serverless-auth headers. Rebuild trusted routing context only from verified credentials/configuration. The bank API independently validates the signed user token and checks tenant, account ownership, role, and domain state. Reject caller-supplied customer/tenant IDs that conflict with verified identity. Scope all demo records by `demo_session_id` and `tenant_id`.

Return `401` for missing/invalid credentials, `403` for denied capabilities, `404` for resources outside the caller's ownership, `409` for stale/conflicting state, `422` for invalid domain input, and `429` for gateway quota exhaustion. Normalize cloud policy faults to this application contract without exposing credentials or internal policy dumps.

## 5. Banking and model API contracts

All bank endpoints use `/bank/v1`. The model endpoint is `POST /ai/v1/generate`. Apigee must preserve these paths when forwarding: configure the bank target base as `/bank/v1` plus the proxy path suffix, and the model target as `/ai/v1` plus suffix. Do not accidentally strip or duplicate the version prefix.

Money is integer minor units with a currency code. Do not use floating-point arithmetic for balances. Dates in fixtures use the fixed demo clock; JWT expiration, request timeouts, and consent expiry use the actual server clock.

Every successful bank response contains `data`, `as_of`, and `trace_id`. Every error has this shape:

```json
{
  "error": {
    "code": "TOOL_NOT_ALLOWED",
    "message": "This application cannot freeze cards.",
    "retryable": false
  },
  "trace_id": "trace-generated-by-server"
}
```

Normalized model request, controlled by server code:

```json
{
  "use_case": "banker",
  "messages": [{"role": "user", "content": "I lost my card."}],
  "tools": [],
  "max_output_tokens": 800,
  "stream": false
}
```

Support `system`, `user`, `assistant`, and `tool` messages. Assistant messages may contain `tool_calls: [{id,name,arguments}]`; each tool result includes the matching `tool_call_id` and serialized content. Tools use `{name,description,input_schema}`. Implement provider-specific transformations in the adapter; do not pass this custom schema to a provider unchanged. The gateway validates use case against the app's allowed list and caps requested output tokens.

Normalized response:

```json
{
  "text": "",
  "tool_calls": [{"id": "call-1", "name": "list_cards", "arguments": {}}],
  "provider": "configured-provider",
  "model": "configured-model",
  "usage": {"input_tokens": 140, "output_tokens": 32},
  "finish_reason": "tool_calls",
  "trace_id": "trace-generated-by-server"
}
```

For the foundation, support one mock provider and one configured live provider. Demo 04 adds a second target, fallback, usage aggregation, and cache behavior. Normalize provider token usage before Apigee response accounting. Mark mock token values as synthetic in events.

## 6. Bounded agent loop

1. Resolve the authenticated user, application, allowed tools, and use case on the server.
2. Send the validated message history and authorized tool schemas through the model proxy.
3. Validate every proposed tool name and argument object against a registry. Reject unknown fields, unknown tools, arbitrary URLs, SQL, and arbitrary code execution.
4. Run permitted tools through Apigee using the original user's delegated identity. Read calls may run concurrently; writes are sequential.
5. Append structured tool results to the conversation and call the model again if needed.
6. Stop after at most six model rounds, twelve tool calls, or the configured run deadline. Use 300 seconds for local large-model development and measure a tighter presentation budget after warm-up. Surface a useful partial result if a limit is reached.

Use an explicit tool-to-handler map. Never let the model construct an arbitrary HTTP target. A denial is a terminal result for that tool; the agent must not retry it using another identity or endpoint.

Implement `POST /app/v1/runs` with `{use_case,message}`, returning a run ID; `GET /app/v1/runs/{id}` returns status and the final answer; `GET /app/v1/runs/{id}/events` streams scoped activity over SSE. The browser talks only to the BFF. Persist run and tool-call IDs so retries do not duplicate writes.

Model prompts must require use of returned data, explicit unknowns, source references where applicable, and truthful reporting of failed actions. A prompt is not an authorization control.

## 7. Human confirmation, approvals, and idempotency

Keep human actions outside the model's tool registry. A proposed mutation has an immutable action ID, canonical payload hash, owner, tenant, expiry, and state. The UI shows the exact action and submits explicit confirmation through a session-authenticated BFF route. The BFF's human-action client is distinct from the agent client, with a separate API product/key and JWT `azp`.

The backend creates a short-lived confirmation bound to the action, subject, resource, payload hash, and session. The agent may receive its opaque reference after confirmation; it cannot mint one. Verify and consume that reference atomically with the mutation. Do not accept `confirmed: true` or a natural-language "yes" supplied by the model as authorization.

For every mutation require `Idempotency-Key`. Uniqueness is `(demo_session_id, tenant_id, subject, operation, key)`. Store request hash and completed response in the same transaction as the state change. Same key and hash returns the original response; same key with different payload returns `409`. A retried completed mutation may return its stored response even after its confirmation has been consumed. Handle concurrent duplicates with a unique constraint and transaction locking.

The agent creates payment/funding proposals only. Distinct human roles perform approvals through protected UI routes. No demo executes a real payment.

## 8. Evidence panel and persistence

Each screen has the business experience on the left and an activity panel on the right. Display tool/model name, allow/deny result, enforcing component, duration, masked resource ID, and trace ID. Do not display chain-of-thought or hidden model reasoning; display actual tool activity and a short user-facing explanation.

Record structured events with these fields:

```json
{
  "event_id": "evt-generated",
  "timestamp": "runtime-utc-timestamp",
  "demo_session_id": "session-generated",
  "tenant_id": "retail-demo",
  "run_id": "run-generated",
  "trace_id": "trace-generated",
  "component": "apigee",
  "operation": "freeze_card",
  "decision": "deny",
  "reason_code": "TOOL_NOT_ALLOWED",
  "elapsed_ms": 12,
  "synthetic": false
}
```

For genuine gateway evidence, emit an authenticated, redacted event from Apigee, including denial fault flows, to the collector using a bounded ServiceCallout or an authenticated logging pipeline. The collector accepts gateway events only from the gateway identity. Event-delivery failure must not undo or retry a completed bank mutation. Deduplicate by event ID. Treat the exact JSON field names above as this application's schema, not native Apigee flow-variable names.

UI counters derive from received events and persisted records. Cloud analytics can lag; do not imply its dashboard updates synchronously. No raw JWTs, API keys, full prompts, full account numbers, or unredacted investigation notes in telemetry.

Minimum shared tables: `demo_sessions`, `runs`, `events`, `action_proposals`, `confirmations`, `idempotency_records`, and use-case domain tables. Reset only the authenticated presenter's synthetic session. Reset is not an agent tool. Apigee quota state is separate; changing a local session must not reset a real app's token allowance.

## 9. Apigee baseline

Build a baseline bank proxy first. Request order: remove untrusted internal headers → assign trace → verify app key → verify user JWT and client binding → check operation/product/scope → validate payload → enforce traffic policies → forward. Attach denial logging and normalized fault responses. Forward the signed user JWT for independent backend checks.

Use explicit named policy files, for example `VAK-App.xml`, `VJWT-User.xml`, `JS-CheckScopes.xml`, `RF-Forbidden.xml`, and `SA-Traffic.xml`. The file names are project conventions. Choose actual XML elements and flow variables from official references and validate them in the target environment. Apigee JavaScript callouts must use syntax supported by the gateway runtime, not arbitrary Node.js libraries.

Model routing is configuration driven. Do not claim Apigee infers task complexity automatically. Token limits and Model Armor are separate capabilities requiring the relevant policies and prerequisites. Native MCP uses JSON-RPC payload operations; restricting only `POST /mcp` is insufficient. [AI capabilities](https://docs.cloud.google.com/apigee/docs/api-platform/get-started/ai-capabilities), [MCP tool controls](https://docs.cloud.google.com/apigee/docs/api-platform/apigee-mcp/manage-mcp-tool-access).

## 10. Cloud deployment sequence

1. Inspect the supplied organization/environment, region, licensing, service accounts, and hostname. Write `docs/capabilities/environment.md` with supported, unavailable, and unverified capabilities. An existing Apigee environment is a prerequisite; provisioning a new organization is a separate infrastructure task.
2. Configure managed PostgreSQL, apply migrations, and seed a dedicated synthetic session. Store secrets in Secret Manager. Use a dedicated deploy identity and runtime service accounts with the permissions actually required.
3. Deploy bank API, model adapter, and evidence collector to Cloud Run with IAM authentication required. Give the Apigee runtime service account permission to invoke its targets. The agent runtime should not have direct bank/model target invocation permission.
4. Deploy BFF/UI with presenter authentication. Make its JWKS endpoint reachable to Apigee; this endpoint exposes public keys only. Configure issuer/audience consistently.
5. Configure backend target authentication using an ID token in `X-Serverless-Authorization`, preserving `Authorization` for the user JWT. Set the ID-token audience to the configured Cloud Run service audience, normally its service URL, rather than a bank operation path. Remove any incoming serverless-auth header before replacing it. [Target authentication reference](https://docs.cloud.google.com/apigee/docs/api-platform/reference/api-proxy-configuration-reference).
6. Verify network reachability separately from IAM. A public service URL with IAM authentication required is acceptable for this synthetic demo. If ingress is restricted to private paths, configure the required Apigee-to-target networking; do not assume IAM creates a network route.
7. Import and deploy bank/model proxies, create operation-restricted products and demo apps, and place app credentials in BFF secrets. Configure optional MCP and Model Armor as specified by the selected guide.
8. Set `GATEWAY_BASE_URL` to Apigee and run cloud smoke checks: successful read, invalid token, unauthorized operation, direct target denial, approved mutation, and observed denial event.
9. Record proxy revisions, target URLs, capability checks, and actual verification outputs. Inventory resources and costs for later cleanup; never use broad deletion scripts against an existing project.

Cloud Run services may perform provider calls using their own service identity/secrets. Model-provider keys remain in the adapter, never in the browser or model prompt.

## 11. Definition of done for the foundation

- Local setup works from documented commands and a generated local signing key.
- Live/mock status is visible for gateway, model, and screening separately.
- User claims cannot be overridden through headers, payloads, or model output.
- An unauthorized direct tool request is denied even if no LLM is involved.
- Human-action credentials are absent from the model dispatcher and tool schemas.
- State and idempotency survive an application restart.
- Run/event reads reject cross-session and cross-tenant access.
- Gateway denial evidence is attributable to the actual enforcing component.
- The live provider adapter handles malformed outputs, timeouts, and missing usage without fabricating success.
- Local validation results and cloud validation results are reported separately.

## 12. API-first mock and test harness

Implement all numbered guides' banking endpoints as stateful mocks in `bank-api`. These are executable domain services over synthetic data, not static JSON screenshots. Reads return persisted fixture state; writes validate identity and mutate it. The mock bank runs in both local and cloud demo modes. Only the gateway and model change between those modes.

Build and test these mocks before the UI or agent loop. The tests must not need an LLM. Generate OpenAPI examples directly from shared fixture definitions so documentation and responses stay aligned. Lists use deterministic sorting; timestamps generated at runtime may differ from examples. Return `as_of: "2026-09-14T00:00:00Z"` for fixed fixture data unless a guide specifies another business timestamp.

Implement these presenter-only harness routes on the BFF, outside Apigee's bank/model tool products:

| Method and path | Request | Result |
| --- | --- | --- |
| `POST /demo/v1/sessions` | `{ "scenario": "banker" }` | `201`, a newly seeded, isolated session and short-lived test credentials |
| `POST /demo/v1/sessions/{id}/reset` | `{}` | `200`, reset this presenter's session, invalidate its pending confirmations and clear its domain state; keep the issued session identity valid |
| `POST /demo/v1/sessions/{id}/faults` | `{ "fault": "primary_model_503", "enabled": true }` | `200`, enable only a documented fault for this session |
| `GET /demo/v1/sessions/{id}/events` | No body | `200`, `{ "data": [event], "trace_id": "..." }` scoped to this presenter's session |

Require `X-Demo-Admin-Key` for all four routes. In cloud mode this must be a random server secret and the harness must also be behind presenter access controls. Never advertise these routes in MCP, tool schemas, public API products, or the customer UI. Do not log returned credentials. This is an explicitly synthetic test harness.

Session response contract:

```json
{
  "session_id": "session-generated",
  "scenario": "banker",
  "credentials": {
    "retail_full": {"access_token": "signed-short-lived-jwt", "api_key": "app-key"},
    "retail_readonly": {"access_token": "signed-short-lived-jwt", "api_key": "app-key"},
    "retail_other": {"access_token": "signed-short-lived-jwt", "api_key": "app-key"},
    "human_customer": {"access_token": "signed-short-lived-jwt", "api_key": "human-action-app-key"}
  },
  "fixture_version": "1"
}
```

Other guides define their persona names. In local mode keys are generated fixture credentials validated by the simulator. In cloud mode the harness uses previously provisioned Apigee app keys from secrets; creating a session must not silently create an Apigee organization, product, or app. Never present local credentials as valid cloud credentials. Tokens contain the newly created session ID.

Use the same requests against the simulator and Apigee by changing `gateway_url`. Testing through the gateway is the default because a direct backend request would not test gateway policies. Internal bank API unit tests may bypass the gateway while still verifying user JWTs and domain permissions.

Postman setup:

1. Import `postman/local.postman_environment.json` and a numbered collection.
2. Set `demo_admin_key` to the value configured in the running mock implementation.
3. Set `harness_url` to `http://localhost:8080` and `gateway_url` to `http://localhost:8088`, or the corresponding cloud URLs.
4. Run the collection in order. Its first request creates a fresh session and stores credentials in collection variables. Later requests store dynamic IDs and assert business results.
5. Clear session credential variables before exporting or sharing a used collection. Keep collection/environment files checked into source control credential-free.

Curl prerequisites: `curl` and `jq`. Every guide begins with a session-bootstrap command and uses the response to obtain tokens and app keys. Do not paste literal `<TOKEN>` values into JSON. The backend contracts and collections are the implementation target; until services have been built, connection refusal is expected.

For negative tests, the simulator must enforce the same documented permissions and normalize errors. Local passage proves the contract works, while actual Apigee deployment tests prove the policy implementation. Record these as separate results.
