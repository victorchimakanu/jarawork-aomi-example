import { encodeFunctionData, getAddress, parseAbi } from 'viem';

export const escrowAbi = parseAbi([
  'function platform() view returns (address)',
  'function getOrder(bytes32 key) view returns ((string orderId,string title,string description,string sourceMarketplace,uint256 amount,address buyer,address worker,uint8 status,uint256 createdAt,uint256 claimedAt,uint256 completedAt,string deliveryProof))',
  'function confirmDelivery(bytes32 key)',
]);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const uint = (value, name) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be an unsigned decimal string`);
  return BigInt(value);
};

// Constructs bytes only. No signer, network request or transaction submission.
export function buildReleaseRequest(config) {
  if (![5042, 5042002].includes(config.chainId)) throw new Error('Unsupported chain');
  const sender = getAddress(config.sender);
  const escrow = getAddress(config.escrow);
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.orderKey) || /^0x0{64}$/.test(config.orderKey)) throw new Error('A nonzero order key is required');
  uint(config.maxOutgoingUsdcWei, 'maxOutgoingUsdcWei');
  if (!Number.isSafeInteger(config.maxGasUnits) || config.maxGasUnits <= 0) throw new Error('Explicit positive maxGasUnits required');
  return {
    executionKind: 'smart_account_calls',
    intent: `Prepare only: JaraWork confirmDelivery for ${config.orderKey}`,
    chainId: config.chainId,
    sender,
    payer: sender,
    calls: [{to: escrow, data: encodeFunctionData({abi: escrowAbi, functionName: 'confirmDelivery', args: [config.orderKey]}), value: '0'}],
    constraints: {allowedTargets: [escrow], maxOutgoingUsdcWei: config.maxOutgoingUsdcWei, maxGasUnits: config.maxGasUnits, minimumReceived: []},
  };
}

// Reads one pinned block. The caller's Circle wallet remains outside this module.
// This local preflight is separate from Aomi's own simulation and is not its proof.
export async function inspectRelease(config, rpc) {
  const request = buildReleaseRequest(config);
  if (await rpc.getChainId() !== config.chainId) throw new Error('RPC chain mismatch');
  const block = await rpc.getBlock({blockTag: 'latest'});
  const base = {address: request.calls[0].to, abi: escrowAbi, blockNumber: block.number};
  const [platform, order] = await Promise.all([
    rpc.readContract({...base, functionName: 'platform'}),
    rpc.readContract({...base, functionName: 'getOrder', args: [config.orderKey]}),
  ]);
  if (getAddress(platform) !== request.sender && getAddress(order.buyer) !== request.sender) throw new Error('Caller is neither platform nor buyer');
  if (Number(order.status) !== 2) throw new Error('Order is not Delivered');
  const delay = uint(config.autoReleaseDelaySeconds, 'autoReleaseDelaySeconds');
  if (BigInt(order.completedAt) === 0n || block.timestamp < BigInt(order.completedAt) + delay) throw new Error('Release delay has not elapsed');
  // Independent business payout cap; do not confuse it with the Task sender's
  // maxOutgoingUsdcWei, since the escrow contract holds the payout funds.
  const maximum = uint(config.maxOrderAmountMicroUsdc, 'maxOrderAmountMicroUsdc');
  if (BigInt(order.amount) <= 0n || BigInt(order.amount) > maximum) throw new Error('Order amount exceeds reviewed payout cap');
  const call = request.calls[0];
  await rpc.call({account: request.sender, to: call.to, data: call.data, value: 0n, blockNumber: block.number});
  return {request, sourceBlock: block.number.toString(), order: {buyer: order.buyer, worker: order.worker, amountMicroUsdc: order.amount.toString()}};
}

// Pass an already configured, independently trusted official TaskClient.
// Its prepare() signs TaskAuthorization and requests a quote, but does not
// purchase the service artifact or sign/submit the business transaction.
export async function prepareRelease(config, {rpc, taskClient, approveTaskAuthorization}) {
  const inspected = freeze(await inspectRelease(config, rpc));
  if (typeof approveTaskAuthorization !== 'function' || !await approveTaskAuthorization(inspected)) throw new Error('Task preparation not approved');
  if (typeof taskClient?.prepare !== 'function') throw new Error('Configured TaskClient required');
  const quote = await taskClient.prepare(inspected.request);
  // The official client's prepare() must verify the signed preview, fees and
  // bindings. A quote is NOT the purchased artifact or an execution receipt.
  return {...inspected, stage: 'quote-only', quote, artifactPurchased: false, transactionSubmitted: false};
}
