import { useEffect, useState } from "react";

type DocumentSummary = {
  id: string;
  externalId: string;
  companyName: string;
  originalFileName: string;
  sourceType: string;
  referenceMode: string;
  createdAt: string;
};

type IngestionJob = {
  id: string;
  status: string;
  source: string;
  documentExternalId?: string;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type QaAnswer = {
  traceId: string;
  finalAnswer: string;
  reasoningSummary: string;
  relevantPages: number[];
  references: Array<{
    documentId: string;
    page: number;
  }>;
};

const sampleLegacyJson = JSON.stringify({
  metainfo: {
    sha1: "stock_10001",
    company_name: "中芯国际",
    file_name: "中芯国际.md"
  },
  content: {
    chunks: [
      {
        lines: [12, 14],
        text: "中芯国际在本期持续推进产能建设，并披露晶圆制造相关经营进展。"
      },
      {
        lines: [22, 24],
        text: "报告中提到公司在成熟制程与特色工艺上的业务布局。"
      }
    ]
  }
}, null, 2);

const pages = [
  { title: "文档列表", description: "查看导入后的文档、来源公司和引用模式。" },
  { title: "旧数据迁移", description: "先导入旧 chunk JSON，后续再补 PDF 解析与 embedding。" },
  { title: "问答", description: "直接调用 API，从已导入 chunk 中返回答案和引用页码。" },
  { title: "任务", description: "查看导入任务状态，为后续解析任务和 embedding 任务预留位置。" }
];

export function App() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [importText, setImportText] = useState(sampleLegacyJson);
  const [importStatus, setImportStatus] = useState<string>("");
  const [uploadCompanyName, setUploadCompanyName] = useState("中芯国际");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [questionText, setQuestionText] = useState("请概括中芯国际本期披露的经营重点");
  const [companyNames, setCompanyNames] = useState("中芯国际");
  const [answer, setAnswer] = useState<QaAnswer | null>(null);
  const [askStatus, setAskStatus] = useState<string>("");

  async function refreshDashboard() {
    const [documentsResponse, jobsResponse] = await Promise.all([
      fetch(`${baseUrl}/documents`),
      fetch(`${baseUrl}/jobs`)
    ]);

    const documentsJson = (await documentsResponse.json()) as { items: DocumentSummary[] };
    const jobsJson = (await jobsResponse.json()) as { ingestionJobs: IngestionJob[] };

    setDocuments(documentsJson.items);
    setJobs(jobsJson.ingestionJobs);
  }

  useEffect(() => {
    async function load() {
      try {
        await refreshDashboard();
      } catch {
        setDocuments([]);
        setJobs([]);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function handleImportSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportStatus("正在导入...");

    try {
      const parsed = JSON.parse(importText) as Record<string, unknown>;
      const response = await fetch(`${baseUrl}/ingestion/legacy-chunk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(parsed)
      });

      if (!response.ok) {
        throw new Error(`导入失败: ${response.status}`);
      }

      await refreshDashboard();
      setImportStatus("导入成功，文档和任务列表已刷新。");
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "导入失败，请检查 JSON 结构。");
    }
  }

  async function handleUploadSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!uploadFile) {
      setUploadStatus("请选择一个 PDF 文件。");
      return;
    }

    setUploadStatus("正在上传并解析...");

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("companyName", uploadCompanyName);

      const response = await fetch(`${baseUrl}/documents/upload`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(`上传失败: ${response.status}`);
      }

      await refreshDashboard();
      setUploadStatus("上传解析完成，文档和任务列表已刷新。");
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "上传失败，请稍后重试。");
    }
  }

  async function handleAskSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAskStatus("正在检索与生成答案...");

    try {
      const response = await fetch(`${baseUrl}/qa/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          questionText,
          companyNames: companyNames
            .split(/[，,\n]/)
            .map((item) => item.trim())
            .filter(Boolean)
        })
      });

      if (!response.ok) {
        throw new Error(`问答失败: ${response.status}`);
      }

      const json = (await response.json()) as QaAnswer;
      setAnswer(json);
      setAskStatus("已返回答案。");
    } catch (error) {
      setAnswer(null);
      setAskStatus(error instanceof Error ? error.message : "问答失败，请稍后重试。");
    }
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">RAG-next</p>
        <h1>企业知识库重构工作台</h1>
        <p className="hero-copy">
          这版已经能在没有数据库的情况下，用内存仓先跑通“旧 chunk 导入 - 文档入库 - 单公司问答 - 引用展示”的最小闭环。
        </p>
      </section>

      <section className="grid">
        {pages.map((page) => (
          <article className="card" key={page.title}>
            <h2>{page.title}</h2>
            <p>{page.description}</p>
          </article>
        ))}
      </section>

      <section className="workspace-grid">
        <section className="panel form-panel">
          <h2>上传 PDF</h2>
          <p className="muted">上传后会调用 MinerU 解析 Markdown，再切分、生成 embedding 并入库。</p>
          <form onSubmit={handleUploadSubmit}>
            <label className="field-label">
              公司名
              <input
                className="text-input"
                value={uploadCompanyName}
                onChange={(event) => setUploadCompanyName(event.target.value)}
                placeholder="例如：中芯国际"
              />
            </label>
            <label className="field-label">
              PDF 文件
              <input
                className="text-input"
                accept="application/pdf,.pdf"
                type="file"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className="form-actions">
              <button className="primary-button" type="submit">上传并入库</button>
              <span className="status-text">{uploadStatus}</span>
            </div>
          </form>
        </section>

        <section className="panel form-panel">
          <div className="panel-heading">
            <h2>导入旧 Chunk JSON</h2>
            <button className="ghost-button" type="button" onClick={() => setImportText(sampleLegacyJson)}>
              载入示例
            </button>
          </div>
          <p className="muted">先粘贴一份旧项目的 chunk JSON，当前会进入 API 的内存仓；后续接上 Postgres 后可无缝复用接口。</p>
          <form onSubmit={handleImportSubmit}>
            <textarea
              className="editor"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              spellCheck={false}
            />
            <div className="form-actions">
              <button className="primary-button" type="submit">导入文档</button>
              <span className="status-text">{importStatus}</span>
            </div>
          </form>
        </section>

        <section className="panel form-panel">
          <h2>发起问答</h2>
          <p className="muted">问题会走 `POST /qa/ask`，当前基于已导入 chunk 做公司匹配和片段检索。</p>
          <form onSubmit={handleAskSubmit}>
            <label className="field-label">
              公司名
              <input
                className="text-input"
                value={companyNames}
                onChange={(event) => setCompanyNames(event.target.value)}
                placeholder="例如：中芯国际, 寒武纪"
              />
            </label>
            <label className="field-label">
              问题
              <textarea
                className="text-input large-input"
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
                placeholder="请输入问题"
              />
            </label>
            <div className="form-actions">
              <button className="primary-button" type="submit">开始问答</button>
              <span className="status-text">{askStatus}</span>
            </div>
          </form>

          <div className="answer-box">
            <h3>问答结果</h3>
            {!answer ? <p>当前还没有结果，先导入文档再提问。</p> : null}
            {answer ? (
              <>
                <p><strong>答案：</strong>{answer.finalAnswer}</p>
                <p><strong>推理摘要：</strong>{answer.reasoningSummary}</p>
                <p><strong>页码：</strong>{answer.relevantPages.length > 0 ? answer.relevantPages.join(", ") : "无"}</p>
                <p><strong>引用：</strong>{answer.references.length > 0 ? answer.references.map((ref) => `${ref.documentId}#p${ref.page}`).join(" / ") : "无"}</p>
                <p><strong>Trace ID：</strong>{answer.traceId}</p>
              </>
            ) : null}
          </div>
        </section>
      </section>

      <section className="panel">
        <h2>API 约定</h2>
        <ul>
          <li><code>GET /documents</code></li>
          <li><code>POST /documents/upload</code></li>
          <li><code>POST /ingestion/legacy-chunk</code></li>
          <li><code>POST /ingestion/legacy-chunk/batch</code></li>
          <li><code>POST /qa/ask</code></li>
          <li><code>GET /jobs</code></li>
        </ul>
      </section>

      <section className="panel">
        <h2>实时数据</h2>
        {loading ? <p>正在加载...</p> : null}
        <div className="split">
          <div>
            <h3>文档</h3>
            {documents.length === 0 ? <p>当前暂无文档。</p> : null}
            <ul className="data-list">
              {documents.map((doc) => (
                <li key={doc.id}>
                  <strong>{doc.companyName}</strong>
                  <span>{doc.originalFileName}</span>
                  <span>{doc.referenceMode} · {doc.sourceType}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>任务</h3>
            {jobs.length === 0 ? <p>当前暂无任务。</p> : null}
            <ul className="data-list">
              {jobs.map((job) => (
                <li key={job.id}>
                  <strong>{job.status}</strong>
                  <span>{job.source}</span>
                  <span>{job.documentExternalId ?? "无 external id"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
