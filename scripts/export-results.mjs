import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeRun, csvText, recordTable } from '../src/records.mjs';

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, out: { type: 'string', default: 'outputs/results' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('node scripts/export-results.mjs --input data/raw.json --out outputs/results');
  } else {
    if (!values.input) throw new Error('请通过 --input 指定原始 JSON 文件');
    const inputPath = path.resolve(values.input);
    const out = path.resolve(values.out);
    const filenames = ['retained.csv', 'observed.csv', 'journals.csv', 'statistics.json', 'records.json'];
    if (filenames.some(name => path.join(out, name) === inputPath)) {
      throw new Error('输出文件会覆盖原始输入，请更换 --out 目录');
    }
    const raw = JSON.parse((await fs.readFile(inputPath, 'utf8')).replace(/^\uFEFF/, ''));
    const { records, retained, journals, stats } = analyzeRun(raw);
    await fs.mkdir(out, { recursive: true });
    const journalTable = [['期刊', '阅读清单条数', 'CSSCI记录', '北核记录', '题名直接包含'],
      ...journals.map(row => [row.journal, row.count, row.cssci, row.pku, row.exact])];
    await fs.writeFile(path.join(out, 'retained.csv'), csvText(recordTable(retained)), 'utf8');
    await fs.writeFile(path.join(out, 'observed.csv'), csvText(recordTable(records)), 'utf8');
    await fs.writeFile(path.join(out, 'journals.csv'), csvText(journalTable), 'utf8');
    await fs.writeFile(path.join(out, 'statistics.json'), JSON.stringify(stats, null, 2) + '\n', 'utf8');
    await fs.writeFile(path.join(out, 'records.json'), JSON.stringify(records, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(stats, null, 2));
    console.log(`输出目录：${out}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
