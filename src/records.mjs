function expectedNumber(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function pageCount(text) {
  const match = String(text ?? '').match(/共找到\s*([\d,]+)\s*条/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

function metric(value, warnings, identity, field) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return Number(text.replaceAll(',', ''));
  warnings.push(`${identity}: ${field} 无法解析，保留空值`);
  return null;
}

function recordType(title) {
  if (/总目|总目录/.test(title)) return '期刊总目';
  if (/书评|——评|新著/.test(title)) return '书评或评介';
  return '文献候选';
}

export function analyzeRun(raw) {
  if (!raw || !raw.stages || typeof raw.stages !== 'object' || Array.isArray(raw.stages)) {
    throw new Error('缺少 stages 采集阶段对象');
  }
  if (typeof raw.query !== 'string' || !raw.query.trim()) throw new Error('缺少 query 检索词');
  const warnings = [];
  const observed = new Map();
  const provenance = new Map();
  const cssci = new Set();
  const pku = new Set();
  const stageChecks = {};
  for (const [key, stage] of Object.entries(raw.stages)) {
    if (!Array.isArray(stage.pages)) throw new Error(`${key}: 缺少 pages 数组`);
    const ids = new Set();
    for (const [pageIndex, page] of stage.pages.entries()) {
      if (!Array.isArray(page.rows)) throw new Error(`${key} 第 ${pageIndex + 1} 个页面缺少 rows`);
      for (const row of page.rows) {
        if (!row.filename || !row.title || !row.journal) {
          throw new Error(`${key}: 记录缺少 filename / title / journal`);
        }
        ids.add(row.filename);
        observed.set(row.filename, row);
        if (!provenance.has(row.filename)) provenance.set(row.filename, new Set());
        provenance.get(row.filename).add(key);
        if (/^cssci(?:_|$)/.test(key)) cssci.add(row.filename);
        if (/^pku(?:_|$)/.test(key)) pku.add(row.filename);
      }
    }
    const expected = expectedNumber(stage.expectedCount);
    stageChecks[key] = { expected, unique: ids.size, complete: expected === null ? null : ids.size === expected };
  }
  const compare = (a, b) => a.priority - b.priority || a.journal.localeCompare(b.journal, 'zh-CN') ||
    (b.citationsNumber ?? -1) - (a.citationsNumber ?? -1) ||
    String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.filename.localeCompare(b.filename);
  const records = [...observed.values()].map(row => {
    const isCssci = cssci.has(row.filename);
    const isPku = pku.has(row.filename);
    const type = recordType(row.title);
    const gradePass = isCssci || isPku;
    return { ...row, authors: Array.isArray(row.authors) ? row.authors : [],
      cssci: isCssci, pku: isPku, gradePass, keep: gradePass && type !== '期刊总目', type,
      exactTitle: row.title.includes(raw.query), priority: isCssci ? 1 : isPku ? 2 : 3,
      group: isCssci ? 'CSSCI' : isPku ? '仅北大核心' : '未命中两类来源',
      citationsNumber: metric(row.citations, warnings, row.filename, '被引'),
      downloadsNumber: metric(row.downloads, warnings, row.filename, '下载'),
      provenance: [...provenance.get(row.filename)],
    };
  }).sort(compare);
  const retained = records.filter(row => row.keep);
  const journalMap = new Map();
  for (const row of retained) {
    if (!journalMap.has(row.journal)) journalMap.set(row.journal, {
      journal: row.journal, count: 0, cssci: 0, pku: 0, exact: 0, priority: row.priority,
    });
    const journal = journalMap.get(row.journal);
    journal.count++;
    journal.cssci += Number(row.cssci);
    journal.pku += Number(row.pku);
    journal.exact += Number(row.exactTitle);
    journal.priority = Math.min(journal.priority, row.priority);
  }
  const journals = [...journalMap.values()].sort((a, b) => a.priority - b.priority ||
    b.count - a.count || a.journal.localeCompare(b.journal, 'zh-CN'));
  const intersection = [...cssci].filter(id => pku.has(id)).length;
  const union = new Set([...cssci, ...pku]).size;
  const cssciExpected = expectedNumber(raw.expectedCounts?.cssci ?? raw.stages.cssci?.expectedCount);
  const pkuExpected = expectedNumber(raw.expectedCounts?.pku ?? raw.stages.pku?.expectedCount);
  const unionExpected = expectedNumber(raw.expectedCounts?.union) ?? pageCount(raw.unionFilterEvidence?.countText);
  const check = (actual, expected) => ({ actual, expected, matches: expected === null ? null : actual === expected });
  const checks = {
    cssci: check(cssci.size, cssciExpected), pku: check(pku.size, pkuExpected), union: check(union, unionExpected),
  };
  for (const [name, result] of Object.entries(checks)) {
    if (result.matches === false) warnings.push(`${name}: 观察数 ${result.actual} 与预期 ${result.expected} 不一致`);
    if (result.expected === null) warnings.push(`${name}: 未提供独立预期数量，无法确认完整性`);
  }
  const journalHits = expectedNumber(raw.stages.all?.expectedCount);
  if (journalHits !== null && observed.size !== journalHits) {
    warnings.push(`全部期刊题录尚未核齐：已观察 ${observed.size}，期刊命中 ${journalHits}`);
  }
  const excluded = records.filter(row => row.gradePass && row.type === '期刊总目');
  const stats = {
    query: raw.query, createdAt: raw.createdAt ?? null, journalHits,
    cssci: cssci.size, pku: pku.size, intersection, sourceUnion: union,
    excludedToc: excluded.length, readingList: retained.length,
    titleContainsExactPhrase: retained.filter(row => row.exactTitle).length,
    journalNames: journals.length, observedUnique: observed.size,
    observedNonCore: records.filter(row => !row.gradePass).length,
    notObserved: journalHits !== null && journalHits >= observed.size ? journalHits - observed.size : null,
    sourceCountsReconciled: Object.values(checks).every(result => result.matches === true),
    checks, stageChecks, warnings,
  };
  return { records, retained, journals, stats };
}

export function csvText(rows) {
  const cell = value => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function recordTable(records) {
  const yes = value => value ? '是' : '否';
  return [
    ['知网编号', '题名', '作者', '期刊', '原始发表时间', '被引', '下载', 'CSSCI', '北大核心',
      '来源等级通过', '纳入阅读清单', '条目类型', '题名含完整词', '文章链接', '期刊链接', '采集阶段'],
    ...records.map(row => [row.filename, row.title, row.authors.join('；'), row.journal, row.date,
      row.citationsNumber, row.downloadsNumber, yes(row.cssci), yes(row.pku), yes(row.gradePass),
      yes(row.keep), row.type, yes(row.exactTitle), row.url, row.journalUrl, row.provenance.join('；')]),
  ];
}
