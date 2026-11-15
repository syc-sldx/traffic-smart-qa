import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTravelContext,resolveTravel,explicitTravel} from '../shared/travel-context.mjs';
import {build} from 'esbuild';
const cities=['南京','上海'],history=[];
function step(q){const r=parseTravelContext(q,history,cities);history.push({role:'user',content:q},{role:'assistant',content:'路线查询结果'});return r;}
test('route follow-ups preserve endpoints while changing mode, preference and destination',()=>{
  step('南京南站怎么去南京新街口站');assert.equal(step('地铁').transport,'transit');assert.equal(step('少换乘一点').strategy,'2');
  const next=step('终点改成苜蓿园站');assert.equal(next.origin,'南京南站');assert.equal(next.destination,'苜蓿园站');assert.equal(next.city,'南京');assert.equal(next.transport,'transit');
  assert.equal(step('少步行一点').transport,'transit');assert.equal(step('改成步行').transport,'walking');
  assert.equal(explicitTravel('那到夫子庙站呢').destination,'夫子庙站');
});
test('a fresh question clears route context and latest explicit text beats contextual fields',()=>{
  const h=[{role:'user',content:'南京从南京南站到新街口坐地铁'},{role:'assistant',content:'路线'},{role:'user',content:'什么是智慧交通'},{role:'assistant',content:'知识回答'}];
  assert.equal(parseTravelContext('地铁',h,cities).origin,undefined);
  const old={city:'南京',origin:'当前位置',destination:'新街口',transport:'transit',action:'route',contextual:'true'};
  const fresh=resolveTravel('上海从虹桥火车站到人民广场怎么去',[],old,cities);assert.equal(fresh.origin,'虹桥火车站');assert.equal(fresh.city,'上海');assert.equal(fresh.transport,undefined);
  assert.equal(resolveTravel('改成步行',[],old,cities).transport,'walking');assert.equal(resolveTravel('少步行一点',[],old,cities).transport,'transit');
  const missing=parseTravelContext('南京',[{role:'user',content:'从当前位置到新街口坐地铁'},{role:'assistant',content:'请补充城市。可以在上方“出行服务”中填写查询条件。'}],cities);assert.equal(missing.city,'南京');assert.equal(missing.destination,'新街口');
});
await build({entryPoints:['server/agent.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:'outputs/followup-test-support.mjs'});
const {ask}=await import('../outputs/followup-test-support.mjs');
test('agent station follow-ups work without map credentials and do not reuse old GPS',async()=>{
  const initial=await ask({},null,'南京南站怎么去南京新街口站',[]);assert.equal(initial.engine,'metro');
  const context={city:'南京',origin:'南京南站',destination:'新街口',transport:'transit',action:'route',contextual:'true'};
  const next=await ask({},null,'终点改成苜蓿园站',[],'auto',context);assert.equal(next.engine,'metro');assert.match(JSON.stringify(next.metro_route),/苜蓿园/);assert.ok(!next.answer.includes(' → 新街口'));
  const least=await ask({},null,'少换乘一点',[],'auto',context);assert.equal(least.engine,'metro');assert.equal(least.metro_route.transfers,0);
  const walking=await ask({},null,'改成步行',[],'auto',{...context,origin:'当前位置'});assert.equal(walking.engine,'travel');assert.equal(walking.needs_input,true);assert.match(walking.answer,/重新定位/);
});
