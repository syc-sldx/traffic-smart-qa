import test from 'node:test';
import assert from 'node:assert/strict';
import {answerEvidence,annotateAnswer} from '../shared/answer-evidence.mjs';

test('annual evidence uses returned statistical years and distinguishes whole-year/end-year periods',()=>{
  const single=answerEvidence({ok:true,engine:'annual',columns:['城市','年份','统计时点','统一数值'],rows:[['南京',2025,'全年',10]]});
  assert.equal(single.kind,'annual');assert.equal(single.label,'年度统计');assert.equal(single.date_value,'2025年 · 全年');
  const mixed=answerEvidence({ok:true,engine:'annual',columns:['年份','统计时点','原始数值'],rows:[[2022,'全年',20],[2025,'年末',3]]});
  assert.match(mixed.date_value,/2022—2025年/);assert.match(mixed.date_value,/全年/);assert.match(mixed.date_value,/年末/);assert.match(mixed.note,/不保证逐年完整覆盖/);assert.match(mixed.note,/口径不同/);
});
test('annual absent values and prompts cannot acquire an invented statistical year',()=>{
  const missing=answerEvidence({ok:true,engine:'annual',answer:'请补充2025年的城市',columns:['年份','统一数值'],rows:[],queried_at:'2026-11-15T10:00:00+08:00'});
  assert.equal(missing.date_value,'未提供');assert.ok(!JSON.stringify(missing).includes('2025'));
  const nullValue=answerEvidence({ok:true,engine:'annual',columns:['年份','统一数值'],rows:[[2025,null]]});assert.equal(nullValue.date_value,'未提供');
  const checklist=answerEvidence({ok:true,engine:'annual',columns:['年份','待补指标','状态'],rows:[[2025,'客流','待补']]});
  assert.equal(checklist.label,'年度资料');assert.equal(checklist.date_label,'资料年份');assert.equal(checklist.date_value,'2025年');assert.match(checklist.note,/不能据此认定已取得年度数值/);
});
test('metro retrieval and map query dates have different meanings and replay never refreshes them',()=>{
  const metro=answerEvidence({ok:true,engine:'metro',retrieved_at:'2026-11-10T15:17:19+00:00',queried_at:'2026-11-15T19:00:00+08:00'});
  assert.equal(metro.kind,'metro_snapshot');assert.equal(metro.date_value,'2026-11-10');assert.match(metro.note,/不等于运营方更新时间/);
  const saved={ok:true,engine:'travel',queried_at:'2026-11-11T09:10:20+08:00',slots:{action:'route'}};
  const first=annotateAnswer(saved),replayed=annotateAnswer(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(first.evidence,replayed.evidence);assert.equal(replayed.evidence.date_value,'2026-11-11 09:10:20+08:00');assert.match(replayed.evidence.note,/不是实际出发/);
  const traffic=answerEvidence({...saved,slots:{action:'traffic'}});assert.equal(traffic.kind,'traffic_query');assert.match(traffic.note,/不等于供应商观测时间/);
});
test('history date ranges come only from explicit temporal columns and do not assert continuous coverage',()=>{
  const range=answerEvidence({ok:true,engine:'verified',domain:'data',columns:['来源','起始日','截止日','日均万人次'],rows:[['A','2024-08-01','2024-08-03',1],['B','2026-03-01','2026-03-24',2]]});
  assert.equal(range.kind,'historical');assert.equal(range.date_value,'2024-08-01 至 2026-03-24');assert.match(range.note,/不保证连续观测/);
  const moment=answerEvidence({ok:true,engine:'verified',columns:['城市','采集时刻'],rows:[['南京','2026-03-24T08:30:00']]});assert.equal(moment.date_label,'采集时刻');assert.equal(moment.date_value,'2026-03-24 08:30:00');
  const aggregate=answerEvidence({ok:true,engine:'model',columns:['MIN(f.stat_date)','MAX(stat_date)'],rows:[['2026-03-01','2026-03-20']]});assert.equal(aggregate.date_value,'2026-03-01 至 2026-03-20');
  const years=answerEvidence({ok:true,engine:'model',columns:['year'],rows:[[2022],[2025]]});assert.equal(years.date_value,'2022—2025年');assert.match(years.note,/不保证连续覆盖/);
  const oneRecordTwoFields=answerEvidence({ok:true,engine:'model',columns:['stat_date','ts'],rows:[['2026-03-24','2026-03-24T08:30:00']]});assert.equal(oneRecordTwoFields.date_value,'2026-03-24');assert.doesNotMatch(oneRecordTwoFields.date_value,/多个/);
});
test('answer prose, request text, arbitrary columns and SQL never supply evidence dates',()=>{
  const value=answerEvidence({ok:true,domain:'data',engine:'model',answer:'2026-11-15最新实时路况',question:'2025年客流',sql:"SELECT '2024-01-01' AS 来源",columns:['来源','备注','日均客流'],rows:[['2024-01-01','2025-01-01',2026]],queried_at:'2026-11-15T10:00:00+08:00'});
  assert.equal(value.kind,'historical');assert.equal(value.date_value,'未提供');assert.ok(!JSON.stringify(value).includes('2026-11-15'));
});
test('invalid calendar dates, times and zones are rejected instead of normalized',()=>{
  for(const date of ['2025-02-29','2024-04-31','2026-00-10','2026-11-00','2026-11-15T24:00:00Z','2026-11-15T09:60:00Z','2026-11-15T09:30:60Z','2026-11-15T09:30:00+14:01','2026-11-15T09:30:00+25:00','2026-11-15junk','<img src=x onerror=x>2026-11-15']){
    assert.equal(answerEvidence({ok:true,engine:'metro',retrieved_at:date}).date_value,'未提供',date);
    assert.equal(answerEvidence({ok:true,engine:'travel',queried_at:date}).date_value,'未提供',date);
  }
  assert.equal(answerEvidence({ok:true,engine:'metro',retrieved_at:'2024-02-29'}).date_value,'2024-02-29');
  assert.equal(answerEvidence({ok:true,engine:'travel',queried_at:'2026-11-15'}).date_value,'未提供');
  assert.equal(answerEvidence({ok:true,engine:'travel',queried_at:'2026-11-15T09:30:00'}).date_value,'未提供');
});
test('failed and incomplete requests cannot be labeled as received real-time evidence',()=>{
  for(const value of [{ok:false},{ok:true,unavailable:true}]){
    const evidence=answerEvidence({...value,engine:'travel',slots:{action:'traffic'},queried_at:'2026-11-15T10:00:00+08:00'});
    assert.equal(evidence.kind,'unavailable');assert.equal(evidence.date_value,undefined);assert.match(evidence.label,/未完成/);
  }
  const pending=answerEvidence({ok:true,engine:'travel',needs_input:true,queried_at:'2026-11-15T10:00:00+08:00'});assert.equal(pending.kind,'needs_input');assert.equal(pending.date_value,undefined);
  const invalidMode=answerEvidence({ok:true,engine:'travel',steps:0,slots:{action:'not-valid'},answer:'请选择路线规划或道路路况。'});assert.equal(invalidMode.kind,'unavailable');assert.equal(invalidMode.date_value,undefined);
});
test('knowledge, memory, unknown payloads and annotations contain only bounded explanatory strings',()=>{
  assert.equal(answerEvidence({ok:true,engine:'knowledge',sources:[{title:'法规2026年'}]}).date_value,'未提供');
  assert.equal(answerEvidence({ok:true,engine:'memory'}).kind,'memory');
  for(const input of [null,[],42,'2026-01-01',{ok:true,engine:'unknown',origin_location:'118.123,32.456'}]){
    const output=annotateAnswer(input);assert.ok(output.evidence);assert.ok(Object.values(output.evidence).every(value=>typeof value==='string'&&value.length<=240));assert.ok(!JSON.stringify(output.evidence).includes('118.123'));
  }
  const original=Object.freeze({ok:true,engine:'metro',retrieved_at:'2026-11-10',evidence:{kind:'fake'}});const annotated=annotateAnswer(original);assert.notEqual(annotated,original);assert.equal(original.evidence.kind,'fake');assert.equal(annotated.evidence.kind,'metro_snapshot');
});
