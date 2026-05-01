# Uniswap Trading API v1 Integration Feedback

## What We Built

We integrated the **Uniswap Trading API v1** into an autonomous AI agent system playing iterated Prisoner's Dilemma tournaments. The core innovation: AI agents (powered by 0G Compute inference) autonomously manage their own treasuries, making real on-chain financial decisions without human intervention.

**Chain:** Unichain Sepolia (1301)
**Tokens:** ETH (native) and USDC (`0x31d0220469e10c4E71834a79b1f276d740d3768F`)
**Router:** Universal Router 2.0 via `x-universal-router-version: 2.0` header

### How Agents Use Uniswap

1. **Auto-Stake (ETH to USDC):** Before entering a tournament, each AI agent receives its balance info and opponent list. The agent's LLM (via 0G Compute) reasons about expected value, risk tolerance, and personality traits, then decides whether to stake and how much ETH to swap into USDC. The swap executes server-side through the full `check_approval` -> `quote` -> `swap` pipeline. ETH amounts are clamped to a `MAX_STAKE_ETH=0.05` safety bound so LLM hallucinations cannot drain a wallet.

2. **Commitment Bonds (USDC transfers as cooperation signals):** During match negotiation rounds, agents can send USDC directly to opponents as a credible "put your money where your mouth is" cooperation signal. The LLM decides bond amounts based on opponent cooperation history, personality, and balance. Amounts are clamped to `0.10-5.00 USDC` safety bounds, and further limited to 50% of available balance. These are real on-chain USDC transfers, not just messages. This is a novel game-theoretic primitive: agents literally pay opponents upfront to incentivize mutual cooperation.

3. **Auto-Cashout (USDC to ETH):** After match completion, agents swap remaining USDC back to ETH through the same Uniswap pipeline. This closes the financial loop for each tournament cycle.

4. **Full Permit2 Flow:** All ERC20 swaps go through the complete Permit2 approval flow. The agent lib checks approval status, sends approval transactions when needed, signs EIP-712 typed data for permit, and includes the signature + permitData in the swap request body.

5. **Swap Persistence:** Every transaction (stakes, cashouts, commitment bonds) is persisted to a `SwapTransaction` database model with agent ID, match ID, token pair, amounts, tx hash, type, and chain ID. These are exposed via `GET /game/swaps` for frontend display and audit.

6. **Backend Proxy:** All Uniswap API calls are proxied through our Fastify backend (`/uniswap/:endpoint`) because the Trading API blocks browser-origin requests (CORS). The proxy allowlists only `check_approval`, `quote`, `swap`, and `order` endpoints.

## What Worked Well

- **The `check_approval` -> `quote` -> `swap` three-step flow is clean and logical.** It maps naturally to an autonomous agent pipeline. Each step has a clear responsibility, and the outputs chain together predictably. This made it straightforward to build a generic `executeAgentSwap()` function that handles any token pair.

- **Permit2 integration is a genuine UX win for agents.** Since our agents manage their own wallets server-side, the EIP-712 signing flow for Permit2 works seamlessly with ethers.js `signTypedData()`. No need for separate approval transactions on every swap after the initial Permit2 approval.

- **The quote response includes routing and gas data.** We feed the quote's price impact and gas estimates back into the LLM's decision prompt so the agent can reason about swap costs when deciding whether to stake. The API provides everything needed for informed financial decisions.

- **Universal Router 2.0 header versioning.** Being explicit about which router version to target via `x-universal-router-version` avoids ambiguity. We set it once in our shared headers object and never thought about it again.

- **The swap response includes a ready-to-sign transaction.** Getting back `to`, `data`, `value`, `gasLimit`, and fee parameters means we can broadcast directly with `wallet.sendTransaction()`. No manual calldata encoding required.

## Issues Encountered

1. **CORS blocking on all browser-origin requests.** The Trading API returns no CORS headers, which means any frontend integration requires a backend proxy. We built a Fastify proxy route (`/uniswap/:endpoint`) that relays requests server-side. This adds latency and infrastructure complexity. Even an API-key-gated CORS mode would be valuable for hackathon and development scenarios. This was the single largest integration friction point.

2. **Unichain Sepolia testnet: finding the correct USDC address.** The API docs focus on mainnet deployments. We had to cross-reference Circle's faucet documentation separately to find the USDC contract address on Unichain Sepolia (`0x31d0220469e10c4E71834a79b1f276d740d3768F`). A testnet token registry or address table in the Trading API docs would save builders significant time.

3. **Opaque error messages.** When a quote or swap fails, the response is typically `{"errorCode": "QUOTE_ERROR"}` with no additional context. During development we encountered this error for multiple distinct root causes: insufficient liquidity, bad token address, amount too small, and rate limiting. Without specifics, debugging required bisecting every parameter manually. More descriptive error payloads (e.g., `{"errorCode": "QUOTE_ERROR", "reason": "INSUFFICIENT_LIQUIDITY", "details": "No route found for pair"}`) would dramatically improve DX.

4. **Quote expiration window is undocumented.** Quotes expire after roughly 30 seconds, but the response contains no explicit `expiresAt` or `validUntil` timestamp. We discovered this through swap failures when the agent's LLM inference took too long between getting a quote and executing the swap. We now fetch the quote as late as possible in the pipeline, but an explicit TTL field would let us implement proper retry logic.

5. **Rate limiting without documentation.** We hit `429 Too Many Requests` during development, particularly when multiple agents were staking concurrently. The response does not include `Retry-After` headers, and the docs do not specify rate limits per API key or per endpoint. We added exponential backoff empirically, but published rate limit tiers would help builders design within constraints from the start.

6. **`permitData: null` must be omitted, not sent.** When `permitData` is null (e.g., for native ETH swaps that don't need Permit2), including `"permitData": null` in the swap request body causes a server-side error. The field must be omitted entirely. This is not documented and caused a subtle bug that only manifested on ETH-input swaps. We solved it by conditionally building the swap body:
   ```ts
   const swapBody: Record<string, any> = { quote };
   if (signature) swapBody.signature = signature;
   if (permitData) swapBody.permitData = permitData;
   ```

7. **Swap body structure: spread vs. wrap.** It was not immediately clear from the docs whether the swap endpoint expects the quote object spread into the body or nested under a `quote` key. The correct approach is `{ quote: quoteResponse }`, not `{ ...quoteResponse }`. We found this through trial and error. A request/response schema or OpenAPI spec for each endpoint would eliminate this class of ambiguity.

## Feature Requests

1. **Explicit `validUntil` timestamp on quote responses.** Even a Unix timestamp indicating when the quote expires would let agents implement proper retry-or-refresh logic instead of guessing a ~30s window.

2. **Richer error payloads with machine-readable reason codes.** An `errorCode` plus a `reason` enum (e.g., `INSUFFICIENT_LIQUIDITY`, `SLIPPAGE_EXCEEDED`, `TOKEN_NOT_SUPPORTED`, `AMOUNT_TOO_SMALL`) would let us build proper error handling branches instead of treating all failures identically.

3. **Documented rate limits and `Retry-After` headers.** Publishing per-key and per-endpoint rate limits, and including `Retry-After` in 429 responses, would let us implement compliant backoff without guessing.

4. **Testnet token registry in docs.** A table of supported token addresses per testnet chain (Unichain Sepolia, Sepolia, Base Sepolia) would save every hackathon builder the same 30-minute address hunt.

5. **WebSocket or SSE price feed.** For our agent treasury dashboard, we poll quotes periodically to show current swap rates. A real-time price stream would reduce API calls and let agents react to price movements.

6. **Batch quote endpoint.** When multiple agents stake concurrently, we issue N sequential quote requests. A batch endpoint accepting multiple token pairs/amounts in one call would reduce round trips and help stay under rate limits.

7. **CORS-enabled mode (even API-key-gated).** Many hackathon projects start as frontend-only. Requiring a backend proxy from day one raises the barrier to entry. An opt-in CORS mode tied to API key origin allowlists would accelerate prototyping.

## DX Friction

- **`permitData: null` must be omitted entirely.** Sending `"permitData": null` in the JSON body causes a 400 error. This is a common JavaScript pattern (`const body = { quote, permitData, signature }` where permitData may be null) and it silently breaks the request. The API should either accept null values or the docs should explicitly warn against including null fields.

- **Quote-into-swap body shape is ambiguous.** The relationship between the quote response and the swap request body is the most critical integration detail, but it is the least documented. Showing a complete request/response example for the swap endpoint (including how quote, signature, and permitData are structured in the body) would be the single highest-impact doc improvement.

- **No OpenAPI spec or typed SDK.** We wrote our own TypeScript types for `SwapResult`, `QuoteResult`, and API responses. An official OpenAPI spec or a generated TypeScript SDK would eliminate guesswork and enable autocomplete in editors.

- **The API key dashboard lacks testnet-specific controls.** There is no visibility into rate limit consumption, no testnet-specific keys, and no usage analytics. Even basic request counts per endpoint would help during development.

- **EIP-712 `types` object includes `EIP712Domain`.** The `permitData.types` returned by the quote endpoint includes `EIP712Domain` as a key. Ethers.js `signTypedData()` adds this automatically, so passing it through causes a duplicate-type error. We had to destructure it out: `const { EIP712Domain, ...types } = permitData.types`. This is a small thing but trips up every ethers.js user.

## Overall

The Uniswap Trading API is well-architected for its core use case. The three-step flow (`check_approval` -> `quote` -> `swap`) is intuitive, and the Permit2 integration is genuinely useful. Our use case (autonomous AI agents making financial decisions and executing swaps server-side) is admittedly non-standard, but the API handled it well once we worked through the initial integration friction.

The highest-impact improvements for hackathon builders would be: (1) CORS support or at minimum documenting the proxy requirement, (2) richer error messages with reason codes, and (3) a complete request/response example for the swap endpoint showing exactly how quote, signature, and permitData fit together.

Total integration time was roughly 6 hours: 2 hours understanding the API flow, 2 hours debugging the issues listed above (CORS proxy, permitData null, swap body shape), and 2 hours building the agent treasury logic that wraps it.
