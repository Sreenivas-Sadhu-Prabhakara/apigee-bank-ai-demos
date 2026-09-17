# 02 — Treasury copilot: payroll resilience

Build with [SHARED_PLATFORM.md](SHARED_PLATFORM.md). Every source and calculation endpoint is a synthetic mock. Import [the Postman collection](postman/02-treasury-copilot.postman_collection.json).

Use local Qwen for scenario extraction and local Gemma for the explanation, following [LOCAL_LLM.md](LOCAL_LLM.md). All arithmetic remains in the mock forecasting service.

## Outcome and scope

A CFO asks: “Can we meet Friday's payroll if our three largest customers pay ten days late?” The app calculates an exact cash shortfall, explains it using source data, and prepares a funding proposal that requires two different human approvers.

Use one company, one currency, one week, and one committed facility. Calculations are deterministic backend code. The model translates the question into a scenario and explains the computed answer. A funding proposal never transfers money or changes the actual balance.

## Synthetic data and expected mathematics

Scenario: `treasury`; tenant `acme-demo`; company `company-001`. Credentials: `treasury_maker`, `treasury_maker_human`, `treasury_approver_1`, `treasury_approver_2`, `treasury_other`.

Business dates: Monday 2026-09-14 through Friday 2026-09-18, inclusive. Calendar-day delays; no weekends, holidays, or FX adjustments in this MVP. Amounts below are INR minor units.

| Item | ID | Date | Amount |
| --- | --- | --- | ---: |
| Opening available cash | `position-001` | 2026-09-14 | 12000000 |
| Customer A receivable | `rec-001` | 2026-09-15 | 8000000 |
| Customer B receivable | `rec-002` | 2026-09-16 | 5000000 |
| Customer C receivable | `rec-003` | 2026-09-17 | 4000000 |
| Supplier payment | `pay-001` | 2026-09-16 | 4000000 |
| Payroll | `pay-002` | 2026-09-18 | 15000000 |
| Undrawn committed facility | `facility-001` | Available from 2026-09-14 | 20000000 |

Formula for each date: `closing = prior_closing + receipts_due_today - payments_due_today`. Required funding is `max(0, -minimum_daily_closing)`. This demo assumes the requested draw is available before the first negative day. It does not model intraday settlement or interest.

| Scenario | Mon | Tue | Wed | Thu | Fri | Required funding |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 12000000 | 20000000 | 21000000 | 25000000 | 10000000 | 0 |
| Delay all three by 10 days | 12000000 | 12000000 | 8000000 | 8000000 | -7000000 | 7000000 |
| Delay rec-001 and rec-002 only | 12000000 | 12000000 | 8000000 | 12000000 | -3000000 | 3000000 |

Thus the headline result is a INR 70,000 shortfall, not INR 7,000,000. Format minor units correctly in every display.

## Mock endpoints

Use the shared response envelope. Read scope is `treasury:read`; calculation scope `treasury:forecast`; proposal scope `funding:prepare`; approval scope `funding:approve`. Maker has read/forecast/prepare. Approvers have read/approve and distinct subjects. `treasury_other` is a different tenant. All persisted POSTs require idempotency keys.

| Method and path | Success data | Tool |
| --- | --- | --- |
| `GET /bank/v1/treasury/position` | `{company_id:"company-001",currency:"INR",available_cash_minor:12000000,as_of_date:"2026-09-14"}` | `get_cash_position` |
| `GET /bank/v1/treasury/receivables` | `{receivables:[{id,customer,due_date,amount_minor,currency}]}` from the fixture table | `list_receivables` |
| `GET /bank/v1/treasury/payables` | `{payables:[{id,type,due_date,amount_minor,currency}]}`; types `SUPPLIER` and `PAYROLL` | `list_payables` |
| `GET /bank/v1/treasury/facilities` | `{facilities:[{id:"facility-001",currency:"INR",available_minor:20000000,status:"COMMITTED"}]}` | `list_facilities` |
| `POST /bank/v1/treasury/forecasts` | `201`, forecast object below | `calculate_cash_forecast` |
| `POST /bank/v1/treasury/funding-proposals` | `201`, proposal below | `prepare_funding_proposal` |
| `GET /bank/v1/treasury/funding-proposals/{id}` | `200`, current proposal including approvals | `get_funding_proposal` |
| `POST /bank/v1/treasury/funding-proposals/{id}/approvals` | `200`, updated proposal | Human route only |

Read responses use `200`. Sort inputs by date and then ID. The position endpoint is tenant-scoped; it accepts no arbitrary company identifier.

Forecast request:

```json
{
  "start_date": "2026-09-14",
  "end_date": "2026-09-18",
  "delays": [{"receivable_id":"rec-001","days":10},{"receivable_id":"rec-002","days":10},{"receivable_id":"rec-003","days":10}]
}
```

Baseline is the same request with `delays: []`. Reject unknown/duplicate receivable IDs, non-integer or negative delays, and a range exceeding 31 days with `422 INVALID_SCENARIO`. Fetch amounts internally; do not accept model-supplied balances. Save an immutable source snapshot with the forecast.

Forecast response `data`:

```json
{
  "id": "forecast-generated",
  "currency": "INR",
  "daily": [
    {"date":"2026-09-14","closing_minor":12000000},
    {"date":"2026-09-15","closing_minor":12000000},
    {"date":"2026-09-16","closing_minor":8000000},
    {"date":"2026-09-17","closing_minor":8000000},
    {"date":"2026-09-18","closing_minor":-7000000}
  ],
  "minimum_closing_minor": -7000000,
  "funding_required_minor": 7000000,
  "first_shortfall_date": "2026-09-18",
  "source_ids": ["position-001","rec-001","rec-002","rec-003","pay-001","pay-002"]
}
```

Proposal request: `{"forecast_id":"<returned>","facility_id":"facility-001","amount_minor":7000000}`. Backend checks snapshot ownership, positive amount, facility availability, and that the amount covers the forecast shortfall. Return `{id,forecast_id,facility_id,amount_minor,currency:"INR",status:"PENDING_APPROVAL",created_by,approvals:[]}`. Amount over the facility limit → `422 FACILITY_LIMIT_EXCEEDED`; insufficient amount → `422 FUNDING_INSUFFICIENT`.

Approval request: `{"decision":"APPROVE"}`. Save approver subject and actual timestamp. First distinct eligible approval keeps `PENDING_APPROVAL`; second sets `APPROVED_FOR_SIMULATION`. Neither action changes `available_cash_minor`. Maker self-approval is `403 SELF_APPROVAL_FORBIDDEN`; same approver with a new idempotency key is `409 ALREADY_APPROVED`; approval after completion is `409 INVALID_STATE`. Same completed idempotency key returns its saved result. Foreign proposal access is `404`.

Persist forecast snapshots, funding proposals, and approvals. Distinct approver enforcement must be a transaction-safe backend rule, not a UI check. Issue `treasury_maker_human` with the maker's same subject and a valid human-approval product/client and approval scope. Use it for the self-approval negative test so the request reaches the backend and exercises the distinct-person rule. The agent's `treasury_maker` client remains unable to invoke approval at the gateway.

## Apigee and application flow

Use a `treasury-agent` product with read/forecast/proposal operations and a separate `treasury-human-approvals` product. Do not expose approval as a model tool. Apply the shared JWT/client binding checks and keep company ownership checks in the backend.

The agent retrieves the four inputs, submits a forecast, and explains the returned daily values. When the user chooses funding, it creates a proposal. The UI then switches to the separately authenticated approval personas to demonstrate two-person approval. Never let a persona-switch label alone determine backend identity.

The UI should show baseline versus delayed daily cash as a line chart, an exact shortfall card, an assumptions drawer, and the approval state. Changing the set of delayed receivables must call the calculation API again. This chart is rendered from backend numbers, not generated by the LLM.

## Curl walkthrough

```bash
export HARNESS_URL=http://localhost:8080
export GATEWAY_URL=http://localhost:8088
session_json=$(curl --fail-with-body -sS -X POST "$HARNESS_URL/demo/v1/sessions" \
  -H "X-Demo-Admin-Key: $DEMO_ADMIN_KEY" -H 'Content-Type: application/json' -d '{"scenario":"treasury"}')
maker_token=$(jq -r '.credentials.treasury_maker.access_token' <<< "$session_json")
maker_key=$(jq -r '.credentials.treasury_maker.api_key' <<< "$session_json")
curl --fail-with-body -sS "$GATEWAY_URL/bank/v1/treasury/position" \
  -H "Authorization: Bearer $maker_token" -H "x-api-key: $maker_key" | jq
forecast_json=$(curl --fail-with-body -sS -X POST "$GATEWAY_URL/bank/v1/treasury/forecasts" \
  -H "Authorization: Bearer $maker_token" -H "x-api-key: $maker_key" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: forecast-delayed-1' \
  -d '{"start_date":"2026-09-14","end_date":"2026-09-18","delays":[{"receivable_id":"rec-001","days":10},{"receivable_id":"rec-002","days":10},{"receivable_id":"rec-003","days":10}]}')
echo "$forecast_json" | jq '.data.funding_required_minor'
# Expected: 7000000
forecast_id=$(jq -r '.data.id' <<< "$forecast_json")
proposal_json=$(curl --fail-with-body -sS -X POST "$GATEWAY_URL/bank/v1/treasury/funding-proposals" \
  -H "Authorization: Bearer $maker_token" -H "x-api-key: $maker_key" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: funding-proposal-1' \
  -d "$(jq -nc --arg id "$forecast_id" '{forecast_id:$id,facility_id:"facility-001",amount_minor:7000000}')")
proposal_id=$(jq -r '.data.id' <<< "$proposal_json")

for persona in treasury_approver_1 treasury_approver_2; do
  approver_token=$(jq -r --arg p "$persona" '.credentials[$p].access_token' <<< "$session_json")
  approver_key=$(jq -r --arg p "$persona" '.credentials[$p].api_key' <<< "$session_json")
  curl --fail-with-body -sS -X POST "$GATEWAY_URL/bank/v1/treasury/funding-proposals/$proposal_id/approvals" \
    -H "Authorization: Bearer $approver_token" -H "x-api-key: $approver_key" \
    -H 'Content-Type: application/json' -H "Idempotency-Key: approval-$persona" \
    -d '{"decision":"APPROVE"}' | jq '.data.status'
done
# Expected: PENDING_APPROVAL, then APPROVED_FOR_SIMULATION
```

The collection also calls every read endpoint, baseline and delayed forecasts, maker self-approval, same-approver rejection, and proposal retrieval.

## Build order and acceptance

1. Implement and unit-test the cash engine against all three exact rows in the expected-mathematics table.
2. Implement the eight mock endpoints and transactional approvals. Pass the API collection.
3. Build the chart and approvals UI, then add the model explanation/tool loop.
4. Configure Apigee products, run the same collection through Apigee, and verify an agent cannot invoke approval.

Acceptance: values match exactly in minor units; scenario input cannot replace source amounts; a second distinct person is required; another tenant cannot retrieve the proposal; the approved proposal does not execute money movement; concurrent approvals cannot create duplicates; reset clears forecasts/proposals and restores source fixtures.

## Five-minute presentation

Ask the headline question → show baseline and delayed curves → reveal INR 70,000 shortfall → change from three delayed customers to two and show INR 30,000 → restore three and prepare funding → reject maker approval → approve as two distinct users → show unchanged real mock cash position.

## Opus 5 build prompt

```text
Implement demo 02 and the shared foundation. Build the mock APIs and cash engine
first. Make the supplied Postman collection pass before adding an LLM or UI.
Use the exact fixtures and expected daily balances, integer minor units, and
the fixed business clock. Implement funding proposals and two distinct human
approvals with backend enforcement and idempotency. Add the chart, agent tools,
and Apigee operation-restricted products. The model must never calculate cash
or approve funding. Deliver local tests and a separate cloud verification report.
```
