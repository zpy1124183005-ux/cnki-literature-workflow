import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { analyzeRun, csvText, pageCount } from '../src/records.mjs';

const fixture = JSON.parse(await fs.readFile(new URL('../examples/raw.example.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(fixture);

test('来源取并集，年份补取按编号去重，总目排除且书评保留', () => {
  const { stats, records, retained, journals } = analyzeRun(copy());
  assert.deepEqual([stats.cssci, stats.pku, stats.intersection, stats.sourceUnion], [2, 3, 1, 4]);
  assert.equal(stats.readingList, 3);
  assert.equal(stats.excludedToc, 1);
  assert.equal(stats.observedUnique, 5);
  assert.equal(stats.notObserved, 1);
  assert.equal(stats.sourceCountsReconciled, true);
  assert.equal(stats.stageChecks.pku.complete, false);
  assert.equal(stats.titleContainsExactPhrase, 2);
  assert.equal(journals.reduce((sum, journal) => sum + journal.count, 0), retained.length);
  assert.equal(records.find(row => row.filename === 'DEMO_D').type, '书评或评介');
  assert.equal(retained.some(row => row.filename === 'DEMO_C'), false);
  assert.deepEqual(records.find(row => row.filename === 'DEMO_A').provenance, ['all', 'cssci', 'pku']);
});

test('缺失被引保留空值，零和千分位正确解析', () => {
  const { records } = analyzeRun(copy());
  assert.equal(records.find(row => row.filename === 'DEMO_B').citationsNumber, null);
  assert.equal(records.find(row => row.filename === 'DEMO_D').citationsNumber, 0);
  assert.equal(records.find(row => row.filename === 'DEMO_A').downloadsNumber, 1234);
});

test('没有完成补取时，不因 complete 字段为 true 宣称来源完整', () => {
  const raw = copy();
  delete raw.stages.pku_to2020;
  raw.stages.pku.complete = true;
  const { stats } = analyzeRun(raw);
  assert.equal(stats.sourceCountsReconciled, false);
  assert.equal(stats.checks.pku.matches, false);
  assert.ok(stats.warnings.some(item => item.startsWith('pku:')));
});

test('同题名不同记录编号保留，记录身份缺失立即报错', () => {
  const raw = copy();
  const original = raw.stages.cssci.pages[0].rows[0];
  raw.stages.cssci.pages[0].rows.push({ ...original, filename: 'DEMO_A_REPRINT' });
  assert.equal(analyzeRun(raw).records.filter(row => row.title === original.title).length, 2);
  delete raw.stages.cssci.pages[0].rows[0].filename;
  assert.throws(() => analyzeRun(raw), /filename/);
});

test('CSV 转义逗号、引号、换行，并防止将文本识别为公式', () => {
  assert.equal(csvText([['含,逗号', '含"引号', '两\n行', '=1+1', null, 0]]),
    '\uFEFF"含,逗号","含""引号","两\n行","\'=1+1","","0"\r\n');
  assert.equal(pageCount('共找到 1,234 条结果'), 1234);
  assert.equal(pageCount('暂无数据'), null);
});

test('非法指标保留为空并明确标记，未提供计数不宣称完整', () => {
  const raw = copy();
  raw.stages.pku_to2020.pages[0].rows[1].citations = '未知';
  delete raw.unionFilterEvidence;
  const { stats, records } = analyzeRun(raw);
  assert.equal(records.find(row => row.filename === 'DEMO_D').citationsNumber, null);
  assert.equal(stats.sourceCountsReconciled, false);
  assert.equal(stats.checks.union.matches, null);
  assert.ok(stats.warnings.some(item => item.includes('无法解析')));
});

test('浏览器模板可被异步脚本执行器解析', async () => {
  const source = await fs.readFile(new URL('../browser/collect-stage.js', import.meta.url), 'utf8');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction('page', source));
});
