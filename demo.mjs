import {buildReleaseRequest} from './release.mjs';
console.log(JSON.stringify({
  mode: 'OFFLINE DEMO — synthetic order, no RPC, signer or Aomi API request',
  request: buildReleaseRequest({chainId:5042,sender:'0xB7FED760971E29BAdFE296e255703eB358195346',escrow:'0x52A34aD73fAe6Bd151F25F1BCDf13AA7781422d5',orderKey:'0x'+'11'.repeat(32),maxOutgoingUsdcWei:'0',maxGasUnits:300000}),
}, null, 2));
