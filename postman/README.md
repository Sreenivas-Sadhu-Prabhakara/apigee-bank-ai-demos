# Postman and curl test assets

Import `local.postman_environment.json` and the desired collection. Keep the environment's `demo_admin_key` private and configure it to match the future mock service. The banking collections describe the implementation contract and require the services in SHARED_PLATFORM.md to be built first.

| Collection | Requests | Required services |
| --- | ---: | --- |
| 00 Local Ollama | 4 | Existing Mac Ollama; can run immediately |
| 01 AI banker | 16 | Harness, gateway simulator or Apigee, bank mock |
| 02 Treasury | 16 | Harness, gateway, bank mock |
| 03 Fraud | 14 | Harness, gateway, bank mock, screening mock or configured Model Armor |
| 04 AI gateway | 21 | Harness, gateway, model adapter, usage ledger |
| 05 Marketplace | 22 | Harness, gateway, bank mock, native MCP or MCP adapter |

Run each collection in order. The first banking request creates an isolated session and stores its credentials and IDs as collection variables. The final reset clears the synthetic state. Collection 05 also resets between REST and MCP phases so an existing invoice reservation cannot interfere with the second phase.

For an actual Apigee run, change `gateway_url` and use the configured presenter's `harness_url`. Cloud harness authentication may require additional organization-specific headers. The Mac model connection stays behind the bridge/adapter, never a direct public Ollama URL.

Set `model_mode=mock` for deterministic model/usage regression tests and `model_mode=ollama` for real Qwen/Gemma inference. This variable describes the running server; changing it in Postman does not reconfigure the server. Set `screening_mode` the same way. Native model token counts vary: guide 04 requires a separate observed live quota-denial check after calibrating allowance and request volume. A passing live collection without a `429` does not prove live token enforcement.

If Apigee's real app quota is already exhausted, session reset does not clear it. Wait for the configured window or use another pre-provisioned dedicated demo app. Do not disable the quota to make a test pass.

Collection 05 assumes the tool names in its guide. In native discovery mode, inspect `tools/list` and map generated tool names/input fields before running its call requests. Keep the documented four-tool interface stable when using the local adapter.

All collection JSON, JavaScript test scripts, request JSON bodies, Markdown JSON examples, relative document links, and bash examples received static validation when this pack was prepared. Direct Qwen JSON generation and Gemma text generation were also exercised successfully. The banking endpoint collections have not been executed because this pack specifies their future implementation.

Clear credential collection variables before exporting a used collection. Do not commit runtime tokens, app keys, admin secrets, or filled-in private environments.
