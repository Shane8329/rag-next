# 中文通用文档轻量混合检索设计

## 1. 背景

当前仓库已经具备以下能力：

- 文档切分后写入 `document_chunks`
- 向量写入 `chunk_embeddings`
- `QaService` 在识别公司后，按公司维度调用 `DocumentRepository.searchChunksByCompany`
- `PgDocumentRepository` 目前只在 SQL 层做 `pgvector` 相似度召回，再在 Node 侧追加一层很轻的中文财报关键词加分

这条链路适合“语义表达接近原文”的问题，但对于中文通用文档里的精确词、术语、数字、年份、缩写、表格字段名等，纯向量召回仍然容易漏召回。现有关键词加分也存在两个问题：

1. 关键词候选并不是独立召回通道，而只是对向量候选做本地补分。
2. 规则明显偏财报语料，不能作为“中文通用文档”检索方案长期保留。

本次需要把检索能力升级为“轻量混合检索”：

- 仍然只使用 Postgres
- 在 Postgres 内完成向量召回、关键词召回、融合重排
- 不引入 Elasticsearch、Milvus、OpenSearch、Redis Search 或独立 reranker 服务

## 2. 目标

### 2.1 功能目标

- 对中文通用文档提供双通道召回：
  - 向量召回：覆盖语义相近表达
  - 关键词召回：覆盖实体词、专业词、数字、年份、短语局部匹配
- 在数据库查询层完成融合重排，返回最终 top N 片段给 `QaService`
- 保持现有 QA 主链路不变：
  - 公司识别逻辑不改
  - LLM 仍只消费检索出的片段
  - `QaAnswer` 对外结构保持兼容

### 2.2 工程目标

- 尽量复用现有表结构与仓储接口，不引入新中间件
- 保持导入链路可增量演进，不重写整条 ingestion 流程
- 让本地测试可稳定验证，不依赖外部中文分词服务

## 3. 非目标

本次不做以下事项：

- 不引入 `zhparser`、Elasticsearch、OpenSearch 等额外检索系统
- 不上线学习式 reranker 或调用额外大模型做二次重排
- 不重做 chunk 切分策略
- 不修改公司识别策略
- 不处理与当前任务无关的 UI、上传流程、部署编排

## 4. 现状梳理

### 4.1 当前查询路径

`apps/api/src/modules/qa/qa.service.ts`

1. 从问题文本或显式入参中确定公司名
2. 对问题生成一个 embedding
3. 对每个公司调用 `searchChunksByCompany(companyName, questionText, questionEmbedding, 3)`
4. 使用返回的片段构造 LLM 上下文

### 4.2 当前仓储实现

`apps/api/src/modules/ingestion/document.repository.ts`

- `InMemoryDocumentRepository`
  - 通过 `cosineSimilarity` 计算向量分数
  - 再叠加 `scoreChunk()` 的关键词补分
- `PgDocumentRepository`
  - SQL 仅按 `ce.embedding <=> $2::vector` 做候选召回
  - Node 侧再调用同一个 `rankChunkCandidates()` 做补分

结论：目前不是“混合召回”，而是“向量召回 + 本地启发式补分”。

## 5. 方案总览

采用“Postgres 内双通道召回 + RRF 融合重排”的轻量方案。

### 5.1 关键词通道设计原则

Postgres 原生中文全文检索对连续汉字分词能力有限，如果直接把原始中文文本喂给 `to_tsvector('simple', text)`，召回质量不稳定。因此本次不依赖数据库中文分词，而是在应用层生成可检索的关键词词元串，再交给 Postgres 的全文检索能力做倒排召回。

### 5.2 融合策略

使用 RRF（Reciprocal Rank Fusion，倒数排序融合）做融合重排：

- 不要求向量分数与关键词分数处在同一量纲
- 对 top-k 候选更稳健
- SQL 实现简单，便于在 Postgres 内完成

### 5.3 最终链路

1. ingestion 时为每个 chunk 生成 `keyword_lexemes`
2. 问答时为 query 生成同构的 `keyword_lexemes`
3. SQL 同时执行：
   - 向量候选召回
   - 关键词候选召回
4. 对两个候选集合做去重、RRF 融合和稳定排序
5. 返回 top N 片段给 `QaService`

## 6. 数据与索引设计

### 6.1 `document_chunks` 新增字段

在 `document_chunks` 增加：

- `keyword_lexemes TEXT NOT NULL DEFAULT ''`

含义：

- 保存应用层生成的“可检索词元串”
- 以空格分隔词元，供 Postgres `to_tsvector('simple', ...)` 使用

示例：

原文片段：

```text
中芯国际 2024 年全年销售收入同比增长。
```

生成后的 `keyword_lexemes` 可形如：

```text
中芯 芯国 国际 2024 全年 销售 售收 收入 同比 增长 中芯国际 销售收入
```

说明：

- 这里不要求保留自然语言顺序语义，只要求提升关键词命中能力
- 对中文采用 2-gram 为主，辅以少量整词
- 对英文、数字、缩写保留原 token

### 6.2 索引设计

新增 GIN 表达式索引：

```sql
create index if not exists idx_document_chunks_keyword_fts
on document_chunks
using gin (to_tsvector('simple', keyword_lexemes));
```

保留现有 `chunk_embeddings` 向量检索能力，不替换 `pgvector`。

如后续验证发现按公司过滤后的扫描仍偏大，可再补充普通 B-Tree 辅助索引，但这不作为本次必做项。

## 7. 词元生成规则

新增一个共享的轻量文本标准化与词元生成工具，供 ingestion 和 query 共用，保证索引侧与查询侧行为一致。

### 7.1 标准化

- Unicode 统一为 NFKC
- 英文转小写
- 去掉大部分标点和重复空白
- 保留中文、英文字母、数字

### 7.2 词元提取

对标准化后的文本提取以下词元：

- 连续中文串：
  - 生成所有相邻 2-gram
  - 对长度在 4 到 12 之间的中文串，额外保留整串作为词元
- 连续英文或数字串：
  - 直接作为词元保留
- 字母数字混合串：
  - 原样保留，例如 `qwen2`, `a800`, `2024q1`

### 7.3 去重与截断

- 词元按首次出现顺序去重
- 单个 chunk 的 `keyword_lexemes` 总长度设置上限，避免极端长文本导致索引膨胀
- query 侧沿用同一规则，但不做过度截断

## 8. 检索与融合流程

### 8.1 候选规模

对每个公司单独检索，最终仍返回 `limit` 条结果，但内部候选扩大：

- `candidateLimit = max(limit * 8, 24)`

说明：

- 向量与关键词通道各自取 `candidateLimit`
- 对最终 `limit=3` 的当前场景，两个通道各取至少 24 条，足够支撑融合

### 8.2 向量召回

保留当前条件：

- 只在命中公司名的文档中检索
- 通过 `chunk_embeddings.embedding <=> query_embedding` 排序

输出字段至少包含：

- chunk 基础信息
- `vector_distance`
- `vector_rank`

### 8.3 关键词召回

基于 query 生成 `queryKeywordLexemes`，再构造 tsquery：

- 使用 `plainto_tsquery('simple', queryKeywordLexemes)`
- 基于 `to_tsvector('simple', dc.keyword_lexemes)` 做匹配
- 用 `ts_rank_cd(...)` 作为关键词通道分数

输出字段至少包含：

- chunk 基础信息
- `keyword_score`
- `keyword_rank`

如果 query 生成不出任何词元，则关键词通道返回空集，不报错。

### 8.4 融合重排

对两个候选集合做 `full outer join` 或 `union all + group by` 去重，按 chunk 维度融合：

```text
fusion_score =
  coalesce(1.0 / (60 + vector_rank), 0)
  + coalesce(1.0 / (60 + keyword_rank), 0)
```

设计说明：

- `60` 为 RRF 常用平滑常数，用于降低 rank 绝对值波动
- 不直接线性混合 `vector_score` 与 `keyword_score`，避免量纲不一致

最终排序优先级：

1. `fusion_score` 降序
2. `vector_rank` 升序，空值排后
3. `keyword_rank` 升序，空值排后
4. `page_start` 升序

### 8.5 返回值

仓储层仍返回 `ChunkSearchResult[]`，兼容现有 `QaService`。

本次建议将 `score` 字段语义改为“最终融合分数”，不再表示纯向量相似度。这样：

- `QaService` 和 `ChatProvider` 无需改接口
- prompt 中展示的 `score` 也更符合最终排序结果

如实现时需要保留更多调试信息，可在仓储内部维护中间字段，但不强制修改对外类型。

## 9. SQL 形态建议

建议在 `PgDocumentRepository.searchChunksByCompany` 内改为单条 SQL，结构类似：

```sql
with vector_candidates as (
  ...
),
keyword_candidates as (
  ...
),
merged as (
  ...
)
select ...
from merged
order by fusion_score desc, ...
limit $n;
```

理由：

- 保持“Postgres 内完成召回与融合”的设计目标
- 少一次应用层候选拼接
- 更利于后续 `EXPLAIN ANALYZE`

`InMemoryDocumentRepository` 不需要完全模拟 SQL 细节，但要保留“向量通道 + 关键词通道 + 融合排序”的等价行为，保证单元测试一致性。

## 10. 对现有代码的影响

### 10.1 需要修改的核心区域

- `db/init/`
  - 增加 schema 变更脚本，补 `keyword_lexemes` 和索引
- `apps/api/src/modules/ingestion/document.repository.ts`
  - 写入 `keyword_lexemes`
  - 改造 `PgDocumentRepository.searchChunksByCompany`
  - 改造 `InMemoryDocumentRepository.searchChunksByCompany`
- `apps/api/src/modules/ingestion/ingestion.types.ts`
  - 如有必要，为检索结果增加可选调试字段
- 新增检索文本工具文件
  - 负责 normalize / tokenize / buildTsQueryText

### 10.2 尽量不改的区域

- `QaService` 对外调用方式
- `ChatProvider` 接口
- 前端页面
- 上传主流程编排

## 11. 边界与异常处理

### 11.1 空 query 词元

如果问题文本在标准化后提取不到关键词词元：

- 关键词通道返回空候选
- 仅保留向量通道结果

### 11.2 空 embedding 或异常输入

维持当前行为：

- embedding 由现有 provider 保证输出
- 仓储层不新增“静默跳过 embedding”逻辑

### 11.3 纯数字 / 年份问题

例如：

- `2024年销售收入`
- `Q1 毛利率`

这类问题对关键词通道应天然友好，因此词元生成必须保留数字和大小写归一化后的短 token。

### 11.4 中文短词问题

例如：

- `诉讼`
- `分红`
- `商誉`

对 2 字中文词，2-gram 规则能够直接覆盖；这正是本次方案适合中文通用文档的关键原因之一。

## 12. 测试与验收

### 12.1 单元测试

至少覆盖：

- 关键词词元生成：
  - 中文
  - 英文
  - 数字
  - 中英混排
  - 空串与标点
- `InMemoryDocumentRepository`：
  - 纯向量命中
  - 纯关键词命中
  - 双通道同时命中
  - 关键词通道空结果
- `PgDocumentRepository`：
  - SQL 中包含向量候选、关键词候选、融合排序片段
  - 参数顺序与候选上限正确

### 12.2 回归测试

至少覆盖现有 QA 场景：

- 向量主导的问题仍能命中正确片段
- 明确关键词问题（数字、年份、术语）比原实现更稳定
- 未识别公司时行为不变
- 显式传入公司名时行为不变

### 12.3 状态矩阵

在“正常态、边界值、零值/空值、异常态、开关差异”维度至少覆盖：

- 正常态：中文财报 / 通用说明文档中的术语检索
- 边界值：`limit=1`、极短 query、极长 chunk
- 零值/空值：query 无关键词词元、公司过滤后无 chunk
- 异常态：数据库关键词通道空结果但向量通道正常
- 开关差异：显式公司名 vs 自动公司识别

## 13. 分阶段落地顺序

推荐按以下顺序实施：

1. 先引入统一的文本标准化与词元生成工具
2. 再补 schema 和 ingestion 写入
3. 再改造 Postgres 查询为双通道融合
4. 最后补齐 `InMemoryDocumentRepository` 和 QA 回归测试

这样可以把风险集中在一个仓储边界内，避免对上层服务造成连锁改动。

## 14. 决策结论

本次中文通用文档轻量混合检索采用以下最终方案：

- 存储层：继续使用 Postgres + pgvector
- 关键词索引：应用层生成 `keyword_lexemes`，数据库使用 `to_tsvector('simple', ...)` + GIN
- 召回：向量召回 + 关键词召回
- 融合：RRF
- 重排位置：Postgres SQL 内完成
- 对外接口：保持 `QaService` 和 `QaAnswer` 兼容

这是当前仓库约束下改动最小、收益最直接、并且对中文通用文档最稳妥的轻量混合检索方案。
