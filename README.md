# RAG-next 企业知识库

> 一句话定位：基于 pnpm Monorepo + NestJS + pgvector 的可插拔式企业级 RAG 知识库系统，支持 PDF（MinerU 解析）与历史 Chunk 双通道入库，DashScope/OpenAI 多模型即插即用。

## 1. 项目概览

| 维度 | 选型 |
| --- | --- |
| 工程形态 | pnpm workspace Monorepo（`apps/*` + `packages/*` + `packages/config/*`） |
| 后端 | NestJS 10（ESM）+ Express + 原生 `pg` + pgvector（不使用 ORM） |
| 前端 | React 19 + Vite 7（单页 `App.tsx`，无路由/状态库） |
| 数据库 | PostgreSQL 16 + pgvector 扩展，向量列 `vector(1536)` |
| 模型层 | Provider 抽象：Embedding（`deterministic` / `openai` / `dashscope`）+ Chat（`extractive` / `openai` / `dashscope`） |
| 文档解析 | MinerU 适配器：`cloud`（HTTP 轮询 OSS）或 `command`（本地子进程） |
| 部署 | Docker 多阶段构建，Nginx 反向代理，三容器栈（`postgres` / `api` / `web`） |

## 2. 目录结构说明

```
RAG-next/
├── apps/                              # 应用层
│   ├── api/                           # NestJS 后端（HTTP + 业务服务 + 数据访问）
│   │   └── src/modules/
│   │       ├── ingestion/             # 入库主链路：上传、解析、切分、仓储、旧数据导入
│   │       ├── knowledge-base/        # 知识库查询（GET /documents）
│   │       ├── qa/                    # 问答主链路（POST /qa/ask）
│   │       └── system/                # env、db Pool、Provider 工厂、jobs 查询
│   ├── web/                           # Vite + React 19 工作台
│   └── worker/                        # 旧数据迁移辅助函数（CLI + 测试）
├── packages/
│   ├── shared-types/                  # 跨端共享类型与纯函数（公司匹配、页码校验、Chunk 转换）
│   └── config/{tsconfig,eslint}/      # 集中式 TS / ESLint 配置
├── db/init/                           # 容器首次启动时加载的 SQL（建扩展 + 建表）
├── deploy/nginx.conf                  # 生产 Nginx 站点配置
├── scripts/                           # 维护脚本：legacy 迁移、fake-mineru（用于离线联调）
├── storage/                           # 文件落盘根目录（uploads/imports/cache，由 .gitignore 占位）
├── Dockerfile                         # 多阶段：deps → build → api / web
├── docker-compose.yml                 # 仅本地 postgres
├── docker-compose.prod.yml            # 生产三服务栈
└── .env / .env.example / .env.production.example
```

职责要点：
- `apps/api/src/modules/system` 是依赖注入入口，所有 Provider 通过 `useFactory` 由环境变量决定具体实现。
- `apps/api/src/modules/ingestion` 同时承载「上传链路」和「旧 JSON 导入链路」，两者最终都收敛到 `DocumentRepository.createLegacyImportJob`。
- `packages/shared-types` 中所有函数均为无副作用纯函数，确保前后端规则一致（公司匹配、页码推断、引用校验）。

## 3. 技术栈详解

### 3.1 后端
| 选型 | 选型原因（实现层面） |
| --- | --- |
| **NestJS 10 + ESM** | 提供模块/DI/异常过滤/拦截器原语；`tsup --format esm` 直出可运行产物；通过 `@Module({providers:[{useFactory}]})` 实现 Provider 多态。 |
| **原生 `pg.Pool`** | 避免引入 TypeORM/Prisma 对 `vector` 类型与 `<=>` 算子的额外适配成本，SQL 完全可控。 |
| **pgvector（`vector(1536)`）** | 用余弦距离 `<=>` 直接在 SQL 内做 ANN（`1 - (embedding <=> $2::vector) as score`），无需独立向量库。 |
| **multer + `FileInterceptor`** | PDF multipart 上传，内存模式直接拿 `buffer` 计算 SHA-1 作为 `externalId`。 |
| **fflate** | 解压 MinerU 返回的 `full_zip_url` zip，纯 JS 实现，无 native 依赖。 |
| **class-validator** | 仅用于 DTO 校验（如 `AskQuestionDto`），不影响核心业务。 |

### 3.2 前端
| 选型 | 选型原因 |
| --- | --- |
| **React 19 + Vite 7** | 单页面、四面板（上传/导入旧 Chunk/问答/实时数据），无需路由/状态库；`import.meta.env.VITE_API_BASE_URL` 由 Docker 构建参数注入。 |
| **原生 fetch** | 直连 REST 接口，零依赖；上线后通过 Nginx 同源 `/api/*` 代理避免 CORS。 |

### 3.3 基础设施
| 组件 | 说明 |
| --- | --- |
| **PostgreSQL 16 + pgvector** | 容器 `pgvector/pgvector:pg16`；`db/init/*.sql` 通过 `docker-entrypoint-initdb.d` 在首启时执行。 |
| **Nginx 1.27** | 静态站点 + `/api/` 反向代理到 `api:3000`；`client_max_body_size 100m` 容忍大 PDF；`proxy_read_timeout 300s` 匹配 MinerU 最长解析时间。 |
| **Docker 多阶段** | `deps` → `build`（pnpm build 全量产物）→ `api`（仅拷贝 dist + 生产依赖）+ `web`（Nginx + 静态文件）。 |

## 4. 整体架构设计

### 4.1 分层
```
┌────────── Web (React/Vite) ──────────┐
│   上传 / 导入 / 问答 / 文档列表      │
└──────────────────┬───────────────────┘
                   │ HTTP (REST)
┌──────────────────▼───────────────────┐
│            NestJS Controller         │
│  Upload / LegacyImport / Qa / Jobs   │
├──────────────────────────────────────┤
│                Service               │
│  DocumentUploadService / QaService   │
├──────────────────────────────────────┤
│             Provider 层              │  ← 由 env 工厂决定
│  EmbeddingProvider / ChatProvider /  │
│  DocumentParser                      │
├──────────────────────────────────────┤
│      DocumentRepository (抽象)       │  ← InMemory 或 Pg
└──────────────────┬───────────────────┘
                   │ SQL
        ┌──────────▼──────────┐
        │  PostgreSQL+pgvector │
        └─────────────────────┘
                   │
        外部依赖：DashScope/OpenAI/MinerU 云
```

### 4.2 关键交互关系
- **依赖注入入口**：`app.module.ts` 通过 4 个 `useFactory` 注入 `DocumentRepository` / `EMBEDDING_PROVIDER` / `CHAT_PROVIDER` / `DOCUMENT_PARSER`，全部由 `process.env` 决定实现类，零代码改动即可切换厂商。
- **双通道入库统一收敛**：PDF 上传链路最终把 MinerU Markdown 切分后包装成 `ImportedLegacyChunkPayload`，与旧 JSON 导入共用 `PgDocumentRepository.createLegacyImportJob`，保证写入路径与幂等策略一致。
- **共享类型层**：`packages/shared-types` 既被 API 编译进运行时，又被 Web 通过 `@rag-next/shared-types` 引用，规则一处定义、前后端一致。

### 4.3 核心流程链路（概览）
1. **PDF 入库链路**：上传 → SHA-1 `externalId` → MinerU 解析 → Markdown 切分 → 落盘 4 类产物 → 生成 embedding → 入库（documents/document_chunks/chunk_embeddings/ingestion_jobs）。
2. **问答链路**：问题 → 公司匹配 → 问题 embedding → pgvector 余弦检索 → 关键词二次加权排序 → 拼接 context → LLM 生成 → 校验引用页码 → 返回 `QaAnswer`。

## 5. 核心业务流程

### 5.1 PDF 上传入库（`POST /documents/upload`）
关键节点与数据流向：

1. **入口** `UploadController.upload`（`upload.controller.ts`）：multer `FileInterceptor("file")` 解析 multipart，取 `buffer + companyName + originalFileName`。
2. **去重键** `DocumentUploadService.importUploadedDocument`（`document-upload.service.ts:45`）：
   ```ts
   const documentExternalId = createHash("sha1").update(buffer).digest("hex");
   ```
   同一 PDF 二次上传得到相同 `externalId`，触发下游 SQL 的 `ON CONFLICT (external_id) DO UPDATE`。
3. **落盘 4 类产物** 到 `STORAGE_ROOT/documents/<externalId>/`：
   - `original.pdf`（原始 buffer）
   - `parsed.md`（MinerU Markdown）
   - `chunks.json`（旧格式兼容 JSON）
   - `mineru/...`（解析原始 zip 内全部文件）
4. **解析适配器** `createMineruDocumentParser()` 根据 `MINERU_PARSER` 选择：
   - `cloud`（默认）：`MineruCloudDocumentParser` 把 `MINERU_PDF_URL_BASE + fileName` 作为 OSS 公网 URL 提交 `/extract/task`，按 `MINERU_POLL_INTERVAL_MS` 轮询直到 `state=done`，下载 `full_zip_url`，`fflate.unzipSync` 解出 `full.md` 与所有 artifacts。
   - `command`：`MineruCommandDocumentParser` 通过 `execFile` 调用本地 MinerU 可执行程序，参数模板支持 `{input}/{output}/{fileName}/{documentId}` 占位符。
5. **Markdown 切分** `splitMarkdownToLegacyChunks`（`markdown-chunker.ts`）：
   - 默认 30 行/块，5 行重叠（步长 25）
   - 仅保留首尾非空行，输出 `lines: [start, end]` 与 `text`
6. **页码回填** `buildMineruPageAnchors`：从 artifacts 中的 `content_list.json` / `content_list_v2.json` 提取每页文本片段，在 Markdown 中按字符 offset 二分查找定位行号，把 chunk 的 `pageStart/pageEnd` 从「按行号 /30 估算」精确为「真实页码区间」。
7. **入库** `PgDocumentRepository.createLegacyImportJob`（`document.repository.ts:294`）：
   - 调用 `EmbeddingProvider.embedDocuments(chunks.map(text))`
   - 三表循环写入：`documents`（`ON CONFLICT external_id` 幂等）→ `document_chunks`（`ON CONFLICT (document_id, chunk_index)`）→ `chunk_embeddings`（`ON CONFLICT chunk_id`，`$2::vector` 强转）
   - 最后写入 `ingestion_jobs`（`job_type=upload`，`payload/result` 为 jsonb）
   - 返回 `IngestionJobRecord`（同步状态 `completed`）

### 5.2 问答检索（`POST /qa/ask`）
关键节点与数据流向：

1. **公司识别** `QaService.answer`（`qa.service.ts:17`）：
   - 若请求带 `companyNames`，直接采用
   - 否则 `matchCompaniesFromQuestion`：按公司名长度倒序、子串匹配、命中后从剩余文本中替换为空格避免重叠误命中
2. **查询向量**：`embeddingProvider.embedQuery(questionText)`（DashScope 走 1024 维 + 内部 `padEmbedding` 补零到 1536）。
3. **向量检索 + 关键词重排** `PgDocumentRepository.searchChunksByCompany`（`document.repository.ts:268`）：
   ```sql
   select ..., 1 - (ce.embedding <=> $2::vector) as "score"
   from document_chunks dc
   inner join documents d on d.id = dc.document_id
   inner join chunk_embeddings ce on ce.chunk_id = dc.id
   where d.company_name = $1
   order by ce.embedding <=> $2::vector asc, dc.page_start asc
   limit $3   -- candidateLimit = max(limit*4, 12)
   ```
   先取 4 倍候选，再经 `rankChunkCandidates` 用关键词命中（`scoreChunk`）二次加权排序，截取最终 `limit`（默认 3）。
4. **引用页码校验** `validateRelevantPages`：用检索片段页码校验「声明页码」，不足 `minPages=2` 时从检索结果补齐，上限 `maxPages=8`。
5. **生成** `ChatProvider.answerQuestion`：
   - System：`Answer from the retrieved context only.`
   - User：`Question + Retrieved context`（`formatContexts` 拼成带 `company/document/pages/score/text` 的多行结构化文本）
   - `temperature: 0.2`
6. **返回** `QaAnswer { traceId, finalAnswer, reasoningSummary, relevantPages, references[] }`。

## 6. 核心模块实现

### 6.1 Provider 抽象与工厂（`system/*.provider.ts` + `database.provider.ts`）
- **`EmbeddingProvider` 接口**：`embedDocuments(texts[])` / `embedQuery(text)` + `modelName`。
- **`OpenAiCompatibleEmbeddingProvider` 基类**：
  - 复用 `/embeddings` 端点，`batchSize` 控制分批
  - `padEmbedding(values, 1536)`：不足补 0、超出截断，保证落库维度恒定
- **`DashScopeEmbeddingProvider`** 重写 `embedDocuments`：
  - 单条文本 >8000 字时按字符切片（`splitTextForDashScope`），多段向量归一化平均（`averageVectors`）合成一条
  - 默认 `batchSize=10`、`dimensions=1024`，再由基类 `padEmbedding` 补到 1536
- **`DeterministicEmbeddingProvider`**：用关键词槽（research/capacity/investment/process）+ 字符 codePoint 哈希构造本地向量，**不依赖任何 API 即可走通全链路**（默认 provider）。
- **`createEmbeddingProvider` / `createChatProvider`**：仅根据 env 字符串分派实例。

### 6.2 DocumentRepository 双实现（`document.repository.ts`）
- **抽象类 `DocumentRepository`**：`listDocuments / listIngestionJobs / listCompanyNames / createLegacyImportJob / searchChunksByCompany`。
- **`createDocumentRepository(queryClient?)`**：
  - 无 `DATABASE_URL` 或无 `queryClient` → 返回 `InMemoryDocumentRepository`（开发态零依赖兜底）
  - 否则 → `PgDocumentRepository`
- **`InMemoryDocumentRepository`** 自带 `cosineSimilarity` 实现，行为与 pgvector 一致，便于在无 DB 环境跑单测。
- **`PgDocumentRepository`** 用原生 SQL + `ON CONFLICT` 实现幂等导入；`searchChunksByCompany` 先粗排再重排。

### 6.3 MinerU 解析适配器（`mineru-*-parser.ts` + `mineru-parser.factory.ts`）
- 工厂函数仅依赖 `MINERU_PARSER`：
  - `cloud`：HTTP `/extract/task` 创建任务 → 轮询 `/extract/task/{id}` → 下载 zip → `unzipSync`
  - `command`：`execFile` + 模板占位符，`ENOENT` 时给出可读错误信息
- 解析后产出统一结构 `{ markdown, rawArtifacts }`，再交由 `DocumentUploadService` 处理。

### 6.4 Markdown 切分（`markdown-chunker.ts`）
- 按行切分（`chunkSize=30 / chunkOverlap=5`），步长 = `chunkSize - chunkOverlap`
- 去除首尾空白行后再 join，输出 `lines: [1-based start, 1-based end]`
- 后续 `inferPageRange` 用 `ceil(line / 30)` 估算页码，与 MinerU `content_list` 真实页码形成「估算 → 校准」两级策略。

### 6.5 共享纯函数（`packages/shared-types/src`）
| 文件 | 函数 | 作用 |
| --- | --- | --- |
| `legacy-chunk-import.ts` | `convertLegacyChunkDocument` | 把旧 `{metainfo,content.chunks}` 转成 `ImportedLegacyChunkPayload` |
| `company-matching.ts` | `matchCompaniesFromQuestion` | 按长度倒序 + 子串替换去重的公司命中算法 |
| `reference-validation.ts` | `validateRelevantPages` | 检索结果回填声明页码，保证引用下限 |
| `types.ts` | 类型定义 | `LegacyChunkDocument` / `ImportedLegacyChunkPayload` / `QaAnswer` 等 |

### 6.6 前端工作台（`apps/web/src/App.tsx`）
- 四面板 + 实时数据：上传 PDF / 导入旧 Chunk JSON / 发起问答 / 实时文档与任务列表
- 启动时 `Promise.all([fetch /documents, fetch /jobs])` 拉取概览；每次写入操作后调用 `refreshDashboard()` 刷新
- 问答结果展示：`finalAnswer / reasoningSummary / relevantPages / references / traceId`

## 7. 依赖与配置

### 7.1 核心运行时依赖
| 包 | 用途 |
| --- | --- |
| `@nestjs/{common,core,platform-express}` 10.4 | 后端框架 |
| `pg` 8.21 | PostgreSQL 驱动 + 连接池 |
| `multer` 2 / `@nestjs/platform-express` | multipart 文件上传 |
| `fflate` 0.8 | zip 解压 |
| `class-transformer` / `class-validator` | DTO 校验 |
| `reflect-metadata` / `rxjs` | Nest DI 装饰器元数据 |
| `uuid` 11 | `randomUUID` 生成 job/chunk id |
| `react` 19 / `react-dom` 19 / `vite` 7 / `@vitejs/plugin-react` | 前端 |

### 7.2 开发依赖
`typescript` 5.8、`tsup` 8（ESM 打包）、`tsx` 4（watch dev）、`vitest` 3（单测）、`eslint` 9 + `typescript-eslint`、`prettier` 3。

### 7.3 运行环境要求
- Node `>=22.0.0`（`engines.node`）
- pnpm `11.5.3`（`packageManager` 字段固定）
- Docker Desktop（启动 pgvector 容器）

### 7.4 关键环境变量
| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | — | 不设则使用 InMemory 仓储 |
| `STORAGE_ROOT` | `<cwd>/storage` | 文档落盘根目录 |
| `EMBEDDING_PROVIDER` | `deterministic` | `deterministic` / `openai` / `dashscope` |
| `CHAT_PROVIDER` | 回退到 `EMBEDDING_PROVIDER`，再回退 `extractive` | `extractive` / `openai` / `dashscope` |
| `DASHSCOPE_EMBEDDING_DIMENSION` | `1024` | **不要设为 1536**，落库列固定 1536，由代码 pad |
| `DASHSCOPE_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI 兼容端点 |
| `MINERU_PARSER` | `cloud` | `cloud` / `command` |
| `MINERU_PDF_URL_BASE` | — | **生产硬依赖**：上传 PDF 必须先放到该 OSS 路径 |
| `MINERU_POLL_INTERVAL_MS` / `MINERU_TIMEOUT_MS` | `5000` / `300000` | 轮询节奏与超时 |
| `PORT` | `3000` | API 端口 |
| `VITE_API_BASE_URL` | 构建期注入 `/api` | 前端 API 前缀 |

> 数据库 schema 见 `db/init/002_schema.sql`：`documents` / `document_pages` / `document_chunks` / `chunk_embeddings(vector 1536)` / `questions` / `answers` / `answer_references` / `ingestion_jobs` / `qa_jobs` 共 9 张表。

## 8. 部署与启动

### 8.1 本地启动
```bash
pnpm install                      # 安装依赖
pnpm db:start                     # docker compose 起 pgvector
pnpm --filter @rag-next/api dev   # NestJS dev (tsx watch)
pnpm --filter @rag-next/web dev   # Vite dev
pnpm migrate:legacy               # 迁移旧 RAG-cy chunked_reports
```

离线联调（无 MinerU Key）使用 fake parser：
```powershell
$env:MINERU_PARSER="command"
$env:MINERU_COMMAND="node"
$env:MINERU_ARGS_TEMPLATE="scripts/fake-mineru.cjs -p {input} -o {output}"
```

直接 curl 上传：
```bash
curl -F "companyName=中芯国际" -F "file=@D:\path\to\report.pdf" http://localhost:3000/documents/upload
```

### 8.2 生产部署（Docker Compose）
```bash
cp .env.production.example .env.production
# 编辑：POSTGRES_*、DASHSCOPE_API_KEY、MINERU_API_KEY、MINERU_PDF_URL_BASE
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

三服务栈：
- `postgres`：pgvector pg16，卷 `postgres-data`，加载 `db/init/*.sql`
- `api`：`node apps/api/dist/main.js`，卷 `storage-data` → `/data/rag-next/storage`
- `web`：Nginx，host 80 → 容器 80，`/api/*` 反代到 `api:3000`

可选：`POSTGRES_IMAGE` / `NODE_IMAGE` / `NGINX_IMAGE` 走私有镜像仓库（如阿里云 ACR）。

### 8.3 常见问题与注意事项
- **DashScope 维度不要设 1536**：列固定 `vector(1536)`，由代码 pad，强行设 1536 会导致请求失败。
- **生产 MinerU 公网可达性**：`MineruCloudDocumentParser` 把 `MINERU_PDF_URL_BASE + 文件名` 当作 OSS 公网 URL 提交给 MinerU。如果上传 PDF 没有先推到 OSS，MinerU 拉不到。生产前需补 OSS 上传步骤。
- **本地 Windows 路径**：`STORAGE_ROOT` 在 `docker-compose.prod.yml` 内被覆盖为 `/data/rag-next/storage`，与本地 `.env` 中的 `D:\rag-cy\storage` 互不干扰。
- **本地 docker-compose.yml** 把数据挂到 `D:/rag-cy/...`，仅适用于开发机；生产用命名卷 `postgres-data` / `storage-data`。
- **InMemory 模式**：未配置 `DATABASE_URL` 时自动启用，所有数据仅存内存，重启即丢，仅用于走通链路。

## 9. 技术亮点与优化建议

### 9.1 技术亮点
1. **Provider 多态 + 零成本切换**：所有外部依赖（Embedding/Chat/Parser/Repository）都通过 Symbol + `useFactory` 注入，切厂商只改 env，不动业务代码。
2. **统一入库收敛点**：PDF 上传与旧 JSON 导入两条路径最终汇入同一 `createLegacyImportJob`，复用幂等 SQL（`ON CONFLICT`）与 embedding 调用，避免双份实现。
3. **DashScope 长文本兼容**：自动按 8000 字切片 → 多段向量归一化平均 → pad 到 1536，规避单次输入上限同时保证维度一致。
4. **页码估算 + 校准双策略**：MinerU `content_list.json` 不可用时用 `ceil(line/30)` 估算；可用时用字符 offset 二分回填真实页码。
5. **InMemory 兜底**：无 DB 环境也能跑通端到端流程，本地开发与 CI 友好。
6. **可观测性基础**：`LoggingExceptionFilter` 统一打印 stack，`traceId` 贯穿 QA 返回结构。
7. **生产 Docker 优化**：多阶段构建 + `--prod --frozen-lockfile` 安装、Nginx 反代避免 CORS、镜像源可通过 ARG 替换。

### 9.2 可改进方向与潜在风险
| 类别 | 问题 | 建议 |
| --- | --- | --- |
| **检索质量** | 关键词二次加权（`scoreChunk`）包含硬编码财务词（`销售收入/营业收入/2024`），偏财务场景 | 抽成可配置词典或改用 BM25 + 向量混合检索（RRF 融合） |
| **检索算法** | 仅 ANN 余弦 + 关键词加权，未做 query rewrite / HyDE / cross-encoder rerank | 引入查询改写、多查询融合、bge-reranker 类精排 |
| **任务异步化** | `ingestion_jobs` 表存在但上传走同步 `await`，MinerU 长解析会阻塞 HTTP 请求（默认 300s 超时） | 改为创建 job → 异步 worker 消费 → 前端轮询 `/jobs`；`apps/worker` 目录已预留 |
| **MinerU 公网依赖** | 生产前 PDF 必须先传 OSS 才能被 MinerU 拉取，当前未实现 OSS 上传步骤 | 在 `MineruCloudDocumentParser.parse` 之前补 OSS 上传，或改用 MinerU 的 base64 / 文件流上传 API |
| **向量维度** | `vector(1536)` 硬编码，pad 0 会稀释相似度（DashScope 1024 → 1536 后多出 512 个 0） | 改用 `vector(1024)` 或动态列；保留 pad 仅作过渡 |
| **事务** | `createLegacyImportJob` 三表写入未包在事务内，中途失败可能残留脏数据 | 用 `BEGIN/COMMIT` 或 `pool.connect()` 单连接事务 |
| **N+1** | 每个 chunk 单独 `insert`，文档 chunk 较多时延迟线性增长 | 改 `unnest` 批量插入或 `pg-format` |
| **安全** | `app.enableCors()` 全开；上传未做认证与文件大小校验（仅 Nginx 100m 限制） | 加白名单 origin、JWT 中间件、multer `limits` |
| **配置一致性** | `DASHSCOPE_EMBEDDING_MODEL` 默认 `text-embedding-v4`，但 `.env.example` 用 `text-embedding-v3` | 统一默认值，避免模型漂移 |
| **可观测性** | 无指标 / 链路追踪（Pino / OpenTelemetry / Prometheus） | 引入结构化日志与 tracing，监控 embedding/chat/parsing 延迟与失败率 |
| **QA 引用** | `references` 仅含 `documentId + page`，未保留 chunk 文本与 score | 前端展示原文片段，提升可信度 |
| **测试覆盖** | 单测覆盖了模块，但缺少端到端集成测试（API → pgvector → 真实 embedding） | 补 `testcontainers` 起 pgvector 的集成测试 |
