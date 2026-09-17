# 05 — Agent-ready banking marketplace

Build with [SHARED_PLATFORM.md](SHARED_PLATFORM.md) and [LOCAL_LLM.md](LOCAL_LLM.md). All banking endpoints are mocks. Import [the Postman collection](postman/05-agent-marketplace.postman_collection.json).

## Outcome and scope

Two accounting partners connect to the same bank. ReconcileCo discovers transaction and reconciliation tools. PayFlow also discovers payment-batch preparation. A direct attempt by ReconcileCo to prepare a batch is denied. A human separately approves PayFlow's draft for simulation.

MVP: two registered apps, one company, three invoices, three bank transactions, four MCP tools, and a separate human approval API. Exclude real onboarding, monetization, production consent flows, and payment execution.

## Fixtures and identities

Scenario `marketplace`; tenant `acme-marketplace`; account `business-account-001`. Credentials: `partner_reconcile`, `partner_prepare`, `partner_approver`, `partner_other`. First two act on behalf of the same company user; `partner_other` belongs to another tenant. `partner_approver` is a distinct authorized human subject.

| Invoice | Amount minor units | Currency | Reference | Expected matching |
| --- | ---: | --- | --- | --- |
| `inv-001` | 5000000 | INR | `INV-001` | Matches bank transaction bt-001 |
| `inv-002` | 3000000 | INR | `INV-002` | Matches bank transaction bt-002 |
| `inv-003` | 2000000 | INR | `INV-003` | Unpaid; eligible for a draft batch |

Transactions: `bt-001` debit `5000000`, reference `INV-001`; `bt-002` debit `3000000`, reference `INV-002`; `bt-003` debit `250000`, reference `BANK-FEE`. All are posted on 2026-09-14 and belong to business-account-001. The bank-fee transaction remains unmatched.

Reconciliation uses exact invoice reference, currency, and amount for the MVP. Duplicate/ambiguous candidates are returned for review; no fuzzy matching is delegated to the model. Payment amounts and beneficiary fixture references are loaded from invoices, never accepted from the LLM.

## Mock banking endpoints

All successful responses use the shared envelope. POST operations require idempotency keys. The REST operations and MCP tools use the same domain handlers.

| Method and path | Request | Success `data` |
| --- | --- | --- |
| `GET /bank/v1/business/transactions` | No body | `200`, `{account_id:"business-account-001",transactions:[{id,amount_minor,currency,direction:"DEBIT",reference,status:"POSTED"}]}` |
| `GET /bank/v1/business/invoices` | No body | `200`, `{invoices:[{id,amount_minor,currency,reference,beneficiary_ref,status:"OPEN"}]}` |
| `POST /bank/v1/business/reconciliations` | `{}` | `201`, result below |
| `POST /bank/v1/business/payment-batches` | `{reconciliation_id,invoice_ids:["inv-003"]}` | `201`, batch below |
| `GET /bank/v1/business/payment-batches/{id}` | No body | `200`, saved batch |
| `POST /bank/v1/business/payment-batches/{id}/approvals` | `{decision:"APPROVE"}` | `200`, updated batch; human only |

Reconciliation result:

```json
{
  "id": "reconciliation-generated",
  "matches": [
    {"invoice_id":"inv-001","transaction_id":"bt-001","method":"EXACT_REFERENCE_AMOUNT"},
    {"invoice_id":"inv-002","transaction_id":"bt-002","method":"EXACT_REFERENCE_AMOUNT"}
  ],
  "unpaid_invoice_ids": ["inv-003"],
  "unmatched_transaction_ids": ["bt-003"],
  "ambiguous_invoice_ids": []
}
```

The result saves its input snapshot. Reconciliation does not mutate invoice status. Batch creation reloads source invoices, verifies the reconciliation belongs to the same session/tenant, and checks invoice eligibility. Return `{id,reconciliation_id,invoice_ids:["inv-003"],total_minor:2000000,currency:"INR",status:"DRAFT",created_by}`. Reject matched invoices with `422 INVOICE_ALREADY_MATCHED`; duplicate invoice IDs with `422 DUPLICATE_INVOICE`; foreign reconciliation with `404`; an already active batch for the same invoice with `409 INVOICE_ALREADY_IN_BATCH`.

Human approval returns the batch with `status:"APPROVED_FOR_SIMULATION"`, `approved_by`, and `approved_at`. Self-approval is `403`; an agent product calling approval is `403`. Do not mark invoices PAID, create debit transactions, or contact a payment provider. Same idempotency key returns its original result, including after an approval.

## MCP contract and tool visibility

Expose `/tools/partners/mcp`. Use a standards-compliant MCP SDK for the adapter and negotiate a mutually supported protocol version. Do not implement only `tools/list` while omitting protocol initialization. Store the agreed protocol version and any `Mcp-Session-Id`; forward them on subsequent requests.

For the supplied collection, support Streamable HTTP with the offered version `2025-06-18`, or adjust the environment to another mutually supported version. Return `202` with no body for an accepted initialized notification, accept JSON or SSE responses for calls, validate origins, and bind MCP sessions to authenticated clients. [MCP transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

| Tool name | Input schema | ReconcileCo | PayFlow |
| --- | --- | --- | --- |
| `list_business_transactions` | Empty object | Allowed | Allowed |
| `list_business_invoices` | Empty object | Allowed | Allowed |
| `reconcile_invoices` | `{request_id:string}` | Allowed | Allowed |
| `prepare_payment_batch` | `{request_id:string,reconciliation_id:string,invoice_ids:string[]}` | Denied and hidden | Allowed |

Require `additionalProperties:false`. `request_id` becomes the idempotency key for the backend mutation, scoped by shared identity rules; the adapter removes it from the REST business payload. Reuse the same request ID on retry. The native MCP path can instead expose the `Idempotency-Key` parameter from OpenAPI if supported; normalize client inputs to it and document the actual generated schema.

No approval, reset, credential issuance, arbitrary HTTP, or customer export tool is published. Batch retrieval can stay a UI REST operation for the four-tool MVP.

Example list request:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

Example tool call:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"reconcile_invoices","arguments":{"request_id":"reconcile-1"}}}
```

For successful tool calls, return the domain `data` as JSON text in `result.content[0].text` with `type:"text"`, and set `isError:false`. You may additionally return `structuredContent` with the same domain object when supported. Tests should accept either representation. Validation or business errors reached through MCP use the negotiated protocol's error conventions; preserve a machine-readable application error code. Gateway authorization denials use HTTP `403` and the shared error envelope in this demo.

## Apigee implementation choices

Preferred: define the REST operations in OpenAPI 3.0.x and create an MCP Discovery Proxy in a supported Apigee environment. Validate the actual discovered tool names/schemas and maintain an explicit mapping to the four names above. Native naming may depend on the imported specification; never assert guessed generated names without calling `tools/list`. [Native MCP quickstart](https://docs.cloud.google.com/apigee/docs/api-platform/apigee-mcp/apigee-mcp-quickstart).

Create separate partner products. Apply `ParsePayload` before product authorization so `tools/call/prepare_payment_batch` can be distinguished from other calls to the same HTTP endpoint. Include `tools/list` and only allowed tool operations in each product; attach supported authentication and quota policies. Verify that discovery filtering and direct-call denial both work. Add shared user JWT checks separately from app/product verification. [Tool access configuration](https://docs.cloud.google.com/apigee/docs/api-platform/apigee-mcp/manage-mcp-tool-access).

Fallback: run an MCP adapter behind Apigee. Apigee must still enforce tool permissions, using parsed method/tool names and verified app allowlists if native payload products are unavailable. The adapter repeats tenant/domain checks, filters discovery, and invokes allowlisted bank operations through the bank proxy with the same partner identity. Never replace a partner key with an unrestricted shared bank key. Label the source of discovery and permission enforcement in the UI.

Manage idempotency propagation explicitly. The same MCP call may retry after a network failure; no retry may create a second batch. Test this through the actual native/adapter path selected for deployment.

## Local Qwen/Gemma behavior

The application is the MCP client. It discovers tools and gives the authorized schemas to Qwen's validated JSON planner. Qwen does not directly speak MCP or receive credentials. Gemma can summarize the reconciliation result, using only returned numbers. See LOCAL_LLM for the adapter protocol supported by the installed models.

Build the UI with two partner cards, a “discover tools” button, a side-by-side tool list, and reconciliation/batch result cards. Tool visibility is read from the endpoint, not hardcoded by partner name. For a predictable boundary demonstration, presenter controls issue a direct forbidden call even if the model correctly refrains from requesting it.

## Curl walkthrough

REST tests work before MCP is implemented:

```bash
export HARNESS_URL=http://localhost:8080
export GATEWAY_URL=http://localhost:8088
session_json=$(curl --fail-with-body -sS -X POST "$HARNESS_URL/demo/v1/sessions" \
  -H "X-Demo-Admin-Key: $DEMO_ADMIN_KEY" -H 'Content-Type: application/json' -d '{"scenario":"marketplace"}')
partner_token=$(jq -r '.credentials.partner_prepare.access_token' <<< "$session_json")
partner_key=$(jq -r '.credentials.partner_prepare.api_key' <<< "$session_json")
reconcile_token=$(jq -r '.credentials.partner_reconcile.access_token' <<< "$session_json")
reconcile_key=$(jq -r '.credentials.partner_reconcile.api_key' <<< "$session_json")
curl --fail-with-body -sS "$GATEWAY_URL/bank/v1/business/invoices" \
  -H "Authorization: Bearer $partner_token" -H "x-api-key: $partner_key" | jq
result_json=$(curl --fail-with-body -sS -X POST "$GATEWAY_URL/bank/v1/business/reconciliations" \
  -H "Authorization: Bearer $partner_token" -H "x-api-key: $partner_key" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: reconciliation-1' -d '{}')
reconciliation_id=$(jq -r '.data.id' <<< "$result_json")
batch_body=$(jq -nc --arg id "$reconciliation_id" '{reconciliation_id:$id,invoice_ids:["inv-003"]}')
# ReconcileCo: expected 403.
curl -sS -i -X POST "$GATEWAY_URL/bank/v1/business/payment-batches" \
  -H "Authorization: Bearer $reconcile_token" -H "x-api-key: $reconcile_key" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: forbidden-batch-1' -d "$batch_body"
# PayFlow: expected 201, total_minor=2000000, status=DRAFT.
curl --fail-with-body -sS -X POST "$GATEWAY_URL/bank/v1/business/payment-batches" \
  -H "Authorization: Bearer $partner_token" -H "x-api-key: $partner_key" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: payment-batch-1' -d "$batch_body" | jq
```

MCP handshake example; set `MCP_PROTOCOL_VERSION` to a version supported by the deployed server/SDK. The collection handles the returned session header automatically:

```bash
curl -sS -i -X POST "$GATEWAY_URL/tools/partners/mcp" \
  -H "Authorization: Bearer $partner_token" -H "x-api-key: $partner_key" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d "$(jq -nc --arg v "$MCP_PROTOCOL_VERSION" \
    '{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:$v,capabilities:{},clientInfo:{name:"bank-demo-curl",version:"1.0.0"}}}')"
```

Then send `notifications/initialized` and `tools/list` with `MCP-Protocol-Version` and, if issued, `Mcp-Session-Id`. Do not reuse one partner's MCP session under another partner's credentials. The Postman collection includes both complete handshakes, discovery checks, and direct denial.

## Build order and acceptance

1. Implement the six stateful REST mocks, reconciliation, and approval rules. Pass REST collection requests.
2. Implement MCP initialization, listing, calling, and identity-preserving dispatch; pass MCP requests.
3. Configure actual Apigee partner products and verify hidden tools are also denied when invoked directly.
4. Add Qwen planning, optional Gemma explanation, and partner comparison UI.

Acceptance: tool lists differ; direct forbidden MCP call fails; two invoices match exactly and one stays unpaid; batch is INR 20,000; duplicate request does not create another batch; agents cannot approve; a different tenant cannot read the batch; no paid invoice or debit transaction appears after simulation approval; reset clears reconciliations and batches.

## Five-minute presentation

Discover as each partner → compare real returned tool lists → reconcile → attempt forbidden preparation as ReconcileCo → prepare as PayFlow → inspect exact invoice-derived amount → approve as a separate human → show a draft/approved simulation with no executed payment.

## Opus 5 build prompt

```text
Implement demo 05 with the shared foundation and LOCAL_LLM.md. Build the six
banking mocks and pass the REST Postman requests first. Then implement complete
MCP sessions, identity-scoped tool discovery, direct-call authorization, and
idempotent dispatch. Prefer native Apigee discovery when available; otherwise
ship the documented adapter and clearly identify its responsibilities.
Use local Qwen JSON planning and Gemma summaries; no native tool support is
assumed. Preserve partner identity through every call. Do not expose approvals
as tools or execute real payments. Deliver tests and a presenter runbook.
```
