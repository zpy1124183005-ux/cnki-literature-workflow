# 浏览器采集与断点格式

## 选择工具

- **豆包工作自身的浏览器工具**：用该环境实际支持的导航、页面读取和文件工具执行。能读取结构化页面时优先保存结构化题录；只能操作界面时按可用界面读取或导出，不凭空声称可以运行 Tabbit 代码。
- **Tabbit Node.js 环境**：确认当前标签页已连接且存在 `page` 对象后，可使用 `browser/collect-stage.js`。修改 `CONFIG` 的关键词、阶段、稳定计数、保存路径、每页条数和真实检索条件。先收当前阶段第一页；续取时保持在断点最后一页。
- **只有已有文件**：先检查题录字段、记录身份及来源依据；符合下面 JSON 格式的文件可直接交给离线脚本。

浏览器模板中的选择器来自 2026-11-06 的页面，不保证长期有效。遇到结构变化，按当前页面重新识别；模板失败不应通过跳过身份或计数检查“修复”。

## 最小断点结构

```json
{
  "query": "用户本次检索词",
  "field": "主题",
  "scope": "学术期刊",
  "createdAt": "实际采集时间，ISO 8601",
  "stages": {
    "cssci": {
      "expectedCount": 1,
      "criteria": {"years": "不限", "sources": ["CSSCI"]},
      "pages": [{
        "page": "1/1",
        "countText": "共找到 1 条结果",
        "observedAt": "实际读取时间，ISO 8601",
        "rows": [{
          "position": 1,
          "filename": "实际知网记录编号",
          "title": "实际篇名",
          "authors": ["实际作者"],
          "journal": "页面原始刊名",
          "date": "页面原始日期",
          "citations": "",
          "downloads": "",
          "url": "",
          "journalUrl": ""
        }]
      }]
    }
  }
}
```

这是结构说明，不能拿其中的示意文本作为真实文献。可执行的虚构例子是 `examples/raw.example.json`。

## 字段和统计约定

- `filename`、`title`、`journal` 为离线脚本必需的记录身份字段。`filename` 是知网记录编号，不是本地文件名。
- 每页可保存 `url`、`countText`、`observedAt`、`sort`、`sourceFilters`，用于复核。数据不随技能包再次上传到 GitHub。
- `expectedCount` 是该阶段实际检索条件下的预期数量；分段补取阶段应填该分段计数。`pku` 的预期数保持完整北大核心范围的数量，分段可命名为 `pku_to2020` 等。
- 按编号汇总各 `cssci`／`cssci_*` 阶段和 `pku`／`pku_*` 阶段。已采集行数与唯一编号数应分别检查，不能用阶段的 `complete: true` 代替核对。
- 可用顶层 `expectedCounts` 的 `cssci`、`pku`、`union` 明确完整范围计数。否则来源预期数来自 `stages.cssci.expectedCount` 和 `stages.pku.expectedCount`；并集预期数来自 `unionFilterEvidence.countText`。
- `all.expectedCount` 是未筛来源的期刊命中总数。未设置则不会计算全期刊缺口；不能据此宣称没有缺口。
- 来源计数一致、页码覆盖合理且条件未变，只是采集完整性的证据；题目相同的不同编号不会自动合并为一篇作品。

遇到阻塞时交付已采集内容、未完成范围及当前断点。来源尚未核齐的记录可以交付，但需明确标注，不能称为最终完整清单。
