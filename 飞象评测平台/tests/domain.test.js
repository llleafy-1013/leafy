import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dimensions,validateCases,validateDimensions,validateAutoScore,validateRubric,parseCSV,calculateReport} from '../server/domain.js';
const cases=JSON.parse(readFileSync(new URL('../server/benchmark.json',import.meta.url)));
test('PRD 首期九条 Query 原文齐全；Q08 以详细任务的高中语文为准',()=>{assert.equal(validateCases(cases).length,9);assert.deepEqual(cases.map(c=>c.id),['Q01','Q02','Q03','Q04','Q05','Q06','Q07','Q08','Q09']);assert.equal(cases[7].subject,'高中语文');assert.match(cases[8].query,/奴隶贸易/);assert.throws(()=>validateCases([cases[0],cases[0]]));});
test('CSV 正确保留带引号、多行与逗号的 Query',()=>{assert.deepEqual(parseCSV('id,query\r\nQ01,"第一行,\n第二行"\r\nQ02,"引号""测试"'),[{id:'Q01',query:'第一行,\n第二行'},{id:'Q02',query:'引号"测试'}]);assert.throws(()=>parseCSV('id\n"未结束'));});
test('权重和 Judge 分数严格校验，不把无效输出作为评分',()=>{assert.equal(validateDimensions(structuredClone(dimensions)).length,5);assert.throws(()=>validateDimensions(dimensions.map(d=>({...d,weight:10}))));assert.throws(()=>validateAutoScore({fulfillment:{score:4,reason:'无效'}}));assert.throws(()=>validateAutoScore({fulfillment:{score:3,reason:'通过'},completeness:{score:2,reason:'通过'}}));assert.throws(()=>validateRubric({}));});
test('多人先对同一 Query 均分，再对 Query 等权；未齐全不得排名或补零',()=>{
 const run={snapshot:{dimensions,cases:cases.slice(0,2),models:[{id:'m',name:'模型'}]}};
 const outputs=[1,2].map(n=>({id:`o${n}`,modelId:'m',caseId:`Q0${n}`,autoScore:{fulfillment:{score:3},completeness:{score:3}}}));
 const scores=n=>({accuracy:n,suitability:n,utility:n});
 const reviews=[{outputId:'o1',reviewerId:'a',scores:scores(1)},{outputId:'o1',reviewerId:'b',scores:scores(3)},{outputId:'o2',reviewerId:'a',scores:scores(3)}];
 let r=calculateReport(run,outputs,reviews,[{id:'a'},{id:'b'}]);assert.equal(r.models[0].values.accuracy,2.5);assert.equal(r.models[0].total,null);assert.equal(r.models[0].rank,null);assert.equal(r.rows[0].disputed,true);
 reviews.push({outputId:'o2',reviewerId:'b',scores:scores(3)});r=calculateReport(run,outputs,reviews,[{id:'a'},{id:'b'}]);assert.ok(Math.abs(r.models[0].total-90)<1e-9);assert.equal(r.models[0].rank,1);
 assert.equal(calculateReport(run,outputs,[],[]).complete,false);
});
