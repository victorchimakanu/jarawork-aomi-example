# JaraWork × Aomi: prepare-only prototype

This is a local prototype for reviewing one `confirmDelivery(bytes32)` call before JaraWork's existing Circle wallet submits it. It is not installed in JaraWork, is not a production release gate, and has not completed a live Aomi simulation.

## Try the offline example

Requires Node 20+ and npm, or Bun. From this directory:

```sh
npm install
npm test
npm run demo
```

The demo uses a synthetic order key. It only constructs calldata: no network, signer, service payment, or escrow transaction. Tests use injected RPC/client fixtures and do not prove hosted compatibility.

## Proposed placement

JaraWork's `server/agent.ts` runs `processAutoRelease()`, then `callEscrow('confirmDelivery(bytes32)', [key])`. The prototype is a separate experiment before that submission point, not a replacement for its signer, dispute decisions or escrow contract. Leave automatic live releases unchanged while evaluating this example.

`inspectRelease(config, rpc)` reads one pinned block, checks the RPC chain, platform/buyer caller, Delivered status, elapsed delay, explicit order-amount cap and successful RPC `eth_call`. This is a local check, separate from Aomi simulation.

`prepareRelease(config, dependencies)` then obtains explicit review approval and invokes only `taskClient.prepare(request)`. The configured official TaskClient signs the exact EIP-712 TaskAuthorization and verifies the returned quote. This authorizes preparation, not execution. There is no call to purchase, execute, sendTransaction, or Circle transaction submission in this module.

## Wiring boundary — still to validate with the builder

```js
import {prepareRelease} from './release.mjs';

// rpc: viem public client for the selected Arc network.
// taskClient: current official TaskClient, independently configured with:
// endpoint, seller, trusted JWKS, fee cap, private persistent state directory,
// RPC URL and builder-controlled signTypedData callback.
// No key or credential should be sent to Aomi or committed in this example.
const preview = await prepareRelease({
  chainId: 5042,
  sender: circleWalletAddress,
  escrow: escrowAddress,
  orderKey,
  autoReleaseDelaySeconds: '3600', // use Jara's actual reviewed configuration
  maxOrderAmountMicroUsdc: '1000000', // example: 1 USDC payout cap, six decimals
  maxOutgoingUsdcWei: '0', // Task SENDER outflow cap, 18 decimals; not escrow payout cap
  maxGasUnits: 300000,
}, {
  rpc,
  taskClient,
  approveTaskAuthorization: async inspected => reviewExactRequest(inspected),
});
// Review locally; do not log private journals or retrieval capabilities.
// Stop here. No artifact purchase or release transaction.
```

All variables and callbacks in this wiring sketch are deliberately supplied by the host application. This is not a turnkey Circle signer adapter. Confirm typed-data signing support for Jara's actual wallet type and SDK, rather than assuming the kit's Circle CLI adapter matches its developer-controlled wallet SDK. A smart-contract wallet may require EIP-1271 validation.

## Live setup status

This prototype still needs a verified mainnet-capable TaskClient build and the builder-controlled Circle typed-data signing callback. Do not assume the high-level payment kit handles arbitrary escrow calls. The local checks do not establish live Aomi preparation, payment or execution.

## What this does not establish

A preparation quote is not a purchased artifact, successful wallet-policy check, settlement or permission to release. State can change after either simulation. An escrow balance pays the worker, so a zero sender-outflow cap does not restrict escrow payouts; the independent order cap above is only part of a required business-policy review. Human dispute decisions and delivery quality remain JaraWork's responsibility.

Before any PR enabling live releases: validate the exact wallet authorization, eligible order, trusted client build, quote evidence, and policy; separately agree any service purchase and business execution. Never fall back to sending funds after a failed check.

## References

- JaraWork: https://github.com/0xAceBit/JaraWork
- Release logic: https://github.com/0xAceBit/JaraWork/blob/main/server/agent.ts
- Escrow: https://github.com/0xAceBit/JaraWork/blob/main/contracts/JaraWorkEscrow.sol
- Reviewed client: https://github.com/aomi-labs/arc-canteen/blob/fb86c38a2335834903ccddada6f82d95218b01ab/packages/task-client/src/index.ts
