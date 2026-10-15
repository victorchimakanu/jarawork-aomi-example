import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData} from 'viem';
import {buildReleaseRequest,inspectRelease,prepareRelease,escrowAbi} from './release.mjs';
const config={chainId:5042,sender:'0xB7FED760971E29BAdFE296e255703eB358195346',escrow:'0x52A34aD73fAe6Bd151F25F1BCDf13AA7781422d5',orderKey:'0x'+'11'.repeat(32),maxOutgoingUsdcWei:'0',maxGasUnits:300000,autoReleaseDelaySeconds:'3600',maxOrderAmountMicroUsdc:'1000000'};
function fixture(overrides={}){
 const order={buyer:'0x1111111111111111111111111111111111111111',worker:'0x2222222222222222222222222222222222222222',status:2,completedAt:1000n,amount:1000000n,...overrides};
 const calls=[];
 const rpc={getChainId:async()=>5042,getBlock:async()=>({number:100n,timestamp:5000n}),readContract:async x=>{calls.push(x);return x.functionName==='platform'?config.sender:order;},call:async x=>{calls.push(x);return {data:'0x'};}};
 return {rpc,calls};
}
test('exact escrow, selector, key, sender and zero value are preserved',()=>{
 const r=buildReleaseRequest(config),d=decodeFunctionData({abi:escrowAbi,data:r.calls[0].data});
 assert.equal(d.functionName,'confirmDelivery');assert.equal(d.args[0],config.orderKey);assert.equal(r.calls[0].to.toLowerCase(),config.escrow.toLowerCase());assert.equal(r.calls[0].value,'0');assert.equal(r.sender.toLowerCase(),config.sender.toLowerCase());
});
test('eligible release uses pinned state and never invokes purchase/execution',async()=>{
 const {rpc,calls}=fixture();let prepared=0;
 const result=await prepareRelease(config,{rpc,approveTaskAuthorization:async()=>true,taskClient:{prepare:async request=>{prepared++;assert.equal(request.chainId,5042);return {quoteId:'synthetic'};},purchase:()=>{throw Error('Forbidden purchase');},execute:()=>{throw Error('Forbidden execution');}}});
 assert.equal(prepared,1);assert.equal(result.artifactPurchased,false);assert.equal(result.transactionSubmitted,false);assert.ok(calls.every(x=>x.blockNumber===100n));
});
test('wrong RPC chain stops before any contract read',async()=>{
 const f=fixture();f.rpc.getChainId=async()=>1;await assert.rejects(inspectRelease(config,f.rpc),/chain mismatch/);assert.equal(f.calls.length,0);
});
test('disputed order is refused',async()=>{await assert.rejects(inspectRelease(config,fixture({status:5}).rpc),/not Delivered/);});
test('unelapsed release delay is refused',async()=>{await assert.rejects(inspectRelease(config,fixture({completedAt:4999n}).rpc),/delay/);});
test('escrow payout cap is independent and enforced',async()=>{await assert.rejects(inspectRelease(config,fixture({amount:1000001n}).rpc),/payout cap/);});
test('unauthorized caller is refused',async()=>{
 const f=fixture();const original=f.rpc.readContract;f.rpc.readContract=async x=>x.functionName==='platform'?'0x3333333333333333333333333333333333333333':original(x);
 await assert.rejects(inspectRelease(config,f.rpc),/neither platform nor buyer/);
});
test('RPC revert stops before Aomi preparation',async()=>{
 const f=fixture();f.rpc.call=async()=>{throw Error('order not found');};let invoked=false;
 await assert.rejects(prepareRelease(config,{rpc:f.rpc,approveTaskAuthorization:async()=>true,taskClient:{prepare:async()=>{invoked=true;}}}),/order not found/);assert.equal(invoked,false);
});
test('review refusal stops before Task authorization',async()=>{
 let invoked=false;await assert.rejects(prepareRelease(config,{rpc:fixture().rpc,approveTaskAuthorization:async()=>false,taskClient:{prepare:async()=>{invoked=true;}}}),/not approved/);assert.equal(invoked,false);
});
test('review cannot change the request',async()=>{
 await assert.rejects(prepareRelease(config,{rpc:fixture().rpc,approveTaskAuthorization:async x=>{x.request.calls[0].to=config.sender;return true;},taskClient:{prepare:async()=>{throw Error('must not reach');}}}),TypeError);
});
test('Aomi preparation failure is propagated, with no fallback execution',async()=>{
 await assert.rejects(prepareRelease(config,{rpc:fixture().rpc,approveTaskAuthorization:async()=>true,taskClient:{prepare:async()=>{throw Error('unsupported authorization');}}}),/unsupported authorization/);
});
test('unknown chains, zero order IDs and missing caps are refused',()=>{
 assert.throws(()=>buildReleaseRequest({...config,chainId:1}),/Unsupported/);
 assert.throws(()=>buildReleaseRequest({...config,orderKey:'0x'+'00'.repeat(32)}),/nonzero/);
 assert.throws(()=>buildReleaseRequest({...config,maxOutgoingUsdcWei:undefined}),/decimal/);
});
