// 在提供 page 对象的 Tabbit Node.js 环境运行；先人工确认当前检索条件。
const CONFIG = {
  query: '乡村治理共同体',
  stage: 'cssci',
  expectedCount: null, // 必填：当前阶段完整范围的稳定页面计数
  checkpoint: './data/raw.json', // 建议改为本机可写的绝对路径
  pageSize: 50,
  maxNextPages: 2,
  criteria: { field: '主题', sources: ['CSSCI'], years: '不限', sort: '按当前页面记录' },
};

if (!Number.isInteger(CONFIG.expectedCount) || CONFIG.expectedCount < 1) {
  throw new Error('请先设置 CONFIG.expectedCount，核对每页条数和当前检索条件');
}
const fs = await import('node:fs/promises');
const path = await import('node:path');
const checkpoint = path.resolve(CONFIG.checkpoint);
let raw;
try {
  raw = JSON.parse((await fs.readFile(checkpoint, 'utf8')).replace(/^\uFEFF/, ''));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  raw = { query: CONFIG.query, field: CONFIG.criteria.field, scope: '学术期刊',
    createdAt: new Date().toISOString(), stages: {} };
}
if (raw.query !== CONFIG.query) throw new Error('断点中的检索词与 CONFIG 不一致，请更换文件');
const stage = raw.stages[CONFIG.stage] ??= {
  expectedCount: CONFIG.expectedCount, pageSize: CONFIG.pageSize, criteria: CONFIG.criteria, pages: [],
};
if (stage.expectedCount !== CONFIG.expectedCount || stage.pageSize !== CONFIG.pageSize ||
    JSON.stringify(stage.criteria) !== JSON.stringify(CONFIG.criteria)) {
  throw new Error('本阶段的计数、每页条数或检索条件已变化，请使用新的阶段名');
}
const save = async () => {
  await fs.mkdir(path.dirname(checkpoint), { recursive: true });
  await fs.writeFile(checkpoint + '.tmp', JSON.stringify(raw, null, 2), 'utf8');
  await fs.rename(checkpoint + '.tmp', checkpoint);
};
const readPage = async () => page.evaluate(() => {
  const captcha = document.querySelector('#tcaptcha_transform_dy');
  const rect = captcha?.getBoundingClientRect();
  if (rect?.width > 0 && rect?.height > 0) return { blocked: 'captcha' };
  const visibleInput = selectors => [...document.querySelectorAll(selectors)]
    .find(element => element.getBoundingClientRect().width > 0)?.value ?? '';
  return {
    url: location.href, observedAt: new Date().toISOString(),
    query: visibleInput('input.search-input, #txt_1_value1'),
    countText: document.querySelector('.pagerTitleCell')?.innerText ?? '',
    page: document.querySelector('.countPageMark')?.innerText?.trim() ?? '',
    sort: document.querySelector('#orderList li.cur')?.innerText?.trim() ?? '',
    sourceFilters: [...document.querySelectorAll('input[type=checkbox]:checked')]
      .filter(element => /CSSCI|北大核心|CSCD|AMI|WJCI/.test(element.parentElement?.innerText ?? ''))
      .map(element => ({ value: element.value, label: element.parentElement.innerText.trim() })),
    rows: [...document.querySelectorAll('.result-table-list tbody tr')].map(row => {
      const title = row.querySelector('td.name a.fz14');
      const record = row.querySelector('a.icon-collect[data-filename]');
      const journal = row.querySelector('td.source a');
      return {
        position: Number(row.querySelector('td.seq')?.innerText?.trim()),
        title: title?.innerText?.trim() ?? '',
        authors: [...row.querySelectorAll('td.author a.KnowledgeNetLink')].map(a => a.innerText.trim()),
        journal: journal?.innerText?.trim() ?? '', date: row.querySelector('td.date')?.innerText?.trim() ?? '',
        citations: row.querySelector('td.quote')?.innerText?.trim() ?? '',
        downloads: row.querySelector('td.download')?.innerText?.trim() ?? '',
        filename: record?.getAttribute('data-filename') ?? '',
        database: record?.getAttribute('data-dbname') ?? '',
        url: title?.href ?? '', journalUrl: journal?.href ?? '', onlineFirst: !!row.querySelector('.marktip'),
      };
    }),
  };
});
const fingerprint = data => JSON.stringify({ count: data.countText.replaceAll(/\s/g, ''),
  sort: data.sort, sources: data.sourceFilters.map(item => item.value).sort() });
const validate = (data, target) => {
  if (data.blocked) throw new Error('captcha：请人工处理后核对检索条件');
  if (!data.rows?.length) throw new Error('site_no_data：当前页面无题录');
  if (data.query && data.query !== CONFIG.query) throw new Error('query_changed');
  const count = data.countText.match(/共找到\s*([\d,]+)\s*条/);
  if (!count || Number(count[1].replaceAll(',', '')) !== CONFIG.expectedCount) {
    throw new Error('count_changed：页面数量与阶段预期不一致');
  }
  if (!data.page && CONFIG.expectedCount <= CONFIG.pageSize) data.page = '1/1';
  const mark = data.page.match(/^(\d+)\s*\/\s*(\d+)$/);
  const total = Math.ceil(CONFIG.expectedCount / CONFIG.pageSize);
  if (!mark || Number(mark[1]) !== target || Number(mark[2]) !== total) throw new Error('unexpected_page');
  const firstPosition = (target - 1) * CONFIG.pageSize + 1;
  const expectedRows = Math.min(CONFIG.pageSize, CONFIG.expectedCount - firstPosition + 1);
  if (data.rows.length !== expectedRows || data.rows.some((row, index) =>
    !row.filename || !row.title || !row.journal || row.position !== firstPosition + index)) {
    throw new Error('invalid_rows：条数、序号或记录身份字段异常');
  }
  if (new Set(data.rows.map(row => row.filename)).size !== data.rows.length) throw new Error('duplicate_ids');
  if (stage.pages.length && fingerprint(data) !== fingerprint(stage.pages[0])) {
    throw new Error('criteria_changed：页面计数、排序或来源标记已变化');
  }
};

let failure = null;
try {
  const current = await readPage();
  if (!stage.pages.length) {
    validate(current, 1);
    stage.pages.push(current);
    await save();
  } else {
    const previous = stage.pages.at(-1);
    validate(current, Number(previous.page.split('/')[0]));
    if (current.rows.map(row => row.filename).join('|') !== previous.rows.map(row => row.filename).join('|')) {
      throw new Error('resume_mismatch：请将浏览器恢复到本阶段断点最后一页');
    }
  }
  for (let index = 0; index < CONFIG.maxNextPages; index++) {
    const [currentNumber, total] = stage.pages.at(-1).page.split('/').map(Number);
    if (currentNumber >= total) break;
    const target = currentNumber + 1;
    await page.locator('#PageNext').click({ timeout: 7000 });
    await page.waitForFunction(({ target, size }) => {
      const captcha = document.querySelector('#tcaptcha_transform_dy')?.getBoundingClientRect();
      if (captcha?.width > 0 && captcha?.height > 0) return true;
      if (document.body.innerText.includes('暂无数据')) return true;
      const mark = document.querySelector('.countPageMark')?.innerText;
      const seq = Number(document.querySelector('td.seq')?.innerText?.trim());
      return mark?.trim().startsWith(target + '/') && seq === (target - 1) * size + 1;
    }, { target, size: CONFIG.pageSize }, { timeout: 20000 });
    const next = await readPage();
    validate(next, target);
    if (stage.pages.some(item => item.page === next.page)) throw new Error('duplicate_page');
    stage.pages.push(next);
    await save();
  }
} catch (error) {
  failure = error.message;
  (stage.errors ??= []).push({ observedAt: new Date().toISOString(), message: failure });
} finally {
  const ids = new Set(stage.pages.flatMap(item => item.rows.map(row => row.filename)));
  stage.complete = ids.size === stage.expectedCount;
  stage.lastFailure = failure;
  await save();
}
return { stage: CONFIG.stage, pagesSaved: stage.pages.length,
  unique: new Set(stage.pages.flatMap(item => item.rows.map(row => row.filename))).size,
  expected: stage.expectedCount, complete: stage.complete, failure, checkpoint };
