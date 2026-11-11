import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['server/travel.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:'outputs/travel-test-support.mjs'});
const {travelAnswer,parseTravel}=await import('../outputs/travel-test-support.mjs');
const env={AMAP_API_KEY:'fixture-only-key'};
const details={city:'南京',origin:'当前位置',destination:'新街口',transport:'transit',origin_location:'118.802063,31.966917'};
const address={status:'1',geocodes:[{level:'兴趣点',location:'118.784123123456,32.041234123456',citycode:[],formatted_address:'南京新街口'}]};

test('temporary 30001 route failures retry once and preserve validated coordinates and city',async()=>{
  const calls=[];let attempts=0;
  const request=async url=>{
    calls.push(url);
    if(url.pathname.endsWith('/geo'))return Response.json(address);
    attempts++;
    return Response.json(attempts===1?{status:'0',infocode:'30001',info:'ENGINE_RESPONSE_DATA_ERROR'}:{status:'1',route:{transits:[{distance:'12000',duration:'2400',segments:[]}]}});
  };
  const result=await travelAnswer(env,'从当前位置到新街口坐地铁',[],details,request);
  assert.equal(attempts,2);assert.ok(!result.unavailable);assert.equal(result.rows[0][1],12);
  assert.equal(calls[1].searchParams.get('cityd'),'南京');assert.equal(calls[1].searchParams.get('destination'),'118.784123,32.041234');assert.equal(calls[1].searchParams.get('origin'),details.origin_location);
});

test('persistent engine failures explain the service response and never claim bad credentials',async()=>{
  let routeCalls=0;
  const request=async url=>{if(url.pathname.endsWith('/geo'))return Response.json(address);routeCalls++;return Response.json({status:'0',infocode:'30001'});};
  const result=await travelAnswer(env,'地铁',[],details,request);
  assert.equal(routeCalls,2);assert.equal(result.unavailable,true);assert.match(result.answer,/服务响应失败/);assert.match(result.answer,/30001/);assert.doesNotMatch(result.answer,/密钥|配额/);assert.equal(result.map_error.attempts,2);
  assert.ok(!JSON.stringify(result).includes('fixture-only-key'));
});

test('invalid keys do not retry and short transport replies retain the previous route',async()=>{
  let calls=0;const request=async()=>{calls++;return Response.json({status:'0',infocode:'10001'});};
  const result=await travelAnswer(env,'坐地铁',[],details,request);assert.equal(calls,1);assert.match(result.answer,/密钥无效/);assert.equal(result.map_error.retryable,false);
  const parsed=parseTravel('地铁',[{role:'user',content:'南京从当前位置到新街口怎么去'},{role:'assistant',content:'请补充出行方式。可以在上方“出行服务”中填写查询条件。'}]);
  assert.equal(parsed.city,'南京');assert.equal(parsed.origin,'当前位置');assert.equal(parsed.destination,'新街口');assert.equal(parsed.transport,'transit');
});
