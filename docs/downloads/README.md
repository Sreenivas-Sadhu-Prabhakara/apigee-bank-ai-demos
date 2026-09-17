# Apigee banking AI demos — implementation pack

Five build specifications for a senior engineering leadership demo. Give these documents to Opus 5 as the implementation brief. Opus 5 is the coding agent in this plan; the demo's runtime model is a configurable dependency, with no assumed model identifier.

These are implementation specifications, not an application that has already been built or deployed. Commands below describe interfaces the implementation must supply.

Every banking dependency is a stateful synthetic mock. Each guide includes endpoint contracts and curl sequences. The `postman/` directory contains importable collections and a local environment for testing the implementation once its mock services are running. No real bank integration is needed.

Start API testing with [the Postman instructions](postman/README.md). There are 93 requests across six collections; the four Ollama checks can run against the existing local model service immediately.

## Pick a demo

| Guide | What the audience sees | Main Apigee capability | Relative effort after foundation |
| --- | --- | --- | --- |
| [01 — AI banker](01-ai-banker.md) | Freeze a lost card and prepare a dispute; deny an unauthorized agent | Authenticated, restricted banking tools | Medium |
| [02 — Treasury copilot](02-treasury-copilot.md) | Recalculate a payroll shortfall and prepare a funding proposal | Governed access to multiple banking APIs | Medium |
| [03 — Fraud investigator](03-fraud-investigator.md) | Build an evidence-linked case brief and show a malicious note being screened | Model Armor integration and independent API authorization | Medium–high |
| [04 — Bank-wide AI gateway](04-bank-wide-ai-gateway.md) | Route model calls, trigger fallback, and exhaust one application's allowance | Model routing, token quotas, observability | Medium; native semantic caching adds infrastructure |
| [05 — Agent marketplace](05-agent-marketplace.md) | Two partner agents discover different banking capabilities | MCP discovery, API products, tool permissions | Medium–high |

Start every build with [SHARED_PLATFORM.md](SHARED_PLATFORM.md). It defines identities, persistence, gateway contracts, local operation, cloud deployment, and evidence requirements. Each guide specifies its own data, endpoints, behavior, demo sequence, and acceptance checks.

Use [LOCAL_LLM.md](LOCAL_LLM.md) for the selected runtime: the Mac's existing Ollama service with `qwen-dev:latest` and `gemma3:12b`. It specifies JSON planning, usage mapping, direct model tests, and the authenticated bridge needed for cloud Apigee to reach the Mac. This local-inference path takes precedence over the generic Cloud Run model deployment in the shared foundation.

Recommended sequence for all five: shared foundation → 01 → 04 → 02 → 03 → 05. Implement the minimal model endpoint in the foundation first; demo 01 does not require the complete demo 04.

## Build modes

| Mode | Gateway | Runtime model | Use |
| --- | --- | --- | --- |
| Local rehearsal | Explicitly labeled gateway simulator | Deterministic mock | Build and test without cloud credentials |
| Connected development | Apigee | Mock or live provider | Verify real gateway policies independently of model behavior |
| Leadership demo | Apigee | Live provider, except deliberately injected failures | Show real requests, enforcement, and synthetic banking outcomes |

Show gateway, model, and screening modes separately in the UI. A mocked model behind real Apigee is different from a fully local simulation. Never label a local denial, mocked screening finding, or exact-match cache as a native Apigee feature.

## What to give Opus 5

For one demo, attach this README, SHARED_PLATFORM.md, LOCAL_LLM.md, and the selected guide. Paste the guide's final build prompt. For all five, use:

```text
Implement the five banking AI demos specified in this implementation pack.
Read README.md, SHARED_PLATFORM.md, and LOCAL_LLM.md, then all five numbered guides.
Use the shared TypeScript monorepo and preserve each guide's API contracts,
seed data, authorization rules, acceptance checks, and presentation sequence.

Build an operational local version first. Deliver a working UI, persistent
synthetic backend, deterministic mock model, gateway simulator, and tests.
Use the installed local Qwen/Gemma models through Ollama for actual inference.
Pass each Postman collection against the mock banking endpoints before adding UI.
Then implement deployable Apigee bundles and the documented cloud path.
Verify policy syntax against the linked official documentation before using it.
Do not invent model IDs, credentials, cloud resource IDs, or successful deployments.

Use one implementation thread by default; no additional coding agents are required.
Work through the recommended sequence and validate each vertical slice.
Keep shared code shared, avoid speculative frameworks, and make each demo resettable.
Record actual command results and distinguish implemented, tested locally,
tested on Apigee, and blocked on cloud configuration.
If cloud credentials are unavailable, complete all local functionality, bundles,
deployment scripts, and verification instructions, then list the exact missing values.
```

## Required deliverables from the implementation

- Five working demo routes, with the selected demo independently runnable.
- Synthetic seed data and a reset mechanism scoped to the selected rehearsal session.
- OpenAPI 3.0.x contracts, JSON schemas, migrations, and a dependency lockfile.
- Apigee proxy bundles, API product configurations, environment templates, and deployment instructions.
- Unit checks for financial calculations and state transitions; integration checks for authorization; browser checks for the demo sequences.
- A live evidence panel that distinguishes gateway decisions, backend decisions, model calls, and presenter-injected faults.
- A capability report listing what was actually validated in the target Apigee environment.
- A short presenter runbook for each demo, plus an environment cleanup inventory.
- Working stateful mock endpoints and passing Postman/curl workflows before adding the AI experience.

## Success standard

The audience can see the useful banking outcome, inspect the API calls that produced it, and watch a specific boundary hold under a deliberate negative test. A polished chat screen alone does not satisfy the specification.

Use synthetic customers, balances, and documents throughout. These demos do not connect to payment rails or make real credit, fraud, or investment decisions.
