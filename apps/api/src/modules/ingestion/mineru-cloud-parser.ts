import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { unzipSync } from "fflate";

import type { DocumentParser, ParsedDocumentArtifactMap, ParsedDocumentResult } from "./document-parser";

interface MineruTaskResponse {
  data?: {
    task_id?: string;
  };
}

interface MineruTaskStatusResponse {
  data?: {
    err_msg?: string;
    full_zip_url?: string;
    state?: string;
  };
}

export interface MineruCloudDocumentParserOptions {
  apiBaseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  outputDir?: string;
  pdfUrlBase?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_MINERU_API_BASE_URL = "https://mineru.net/api/v4";
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 300000;

export class MineruCloudDocumentParser implements DocumentParser {
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly outputDir: string;
  private readonly pdfUrlBase: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(options: MineruCloudDocumentParserOptions = {}) {
    this.apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? process.env.MINERU_API_BASE_URL ?? DEFAULT_MINERU_API_BASE_URL);
    this.apiKey = requireValue(options.apiKey ?? process.env.MINERU_API_KEY, "MINERU_API_KEY");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.outputDir = options.outputDir ?? process.env.MINERU_OUTPUT_DIR ?? join(process.cwd(), ".tmp", "mineru");
    this.pdfUrlBase = requireValue(options.pdfUrlBase ?? process.env.MINERU_PDF_URL_BASE, "MINERU_PDF_URL_BASE");
    this.pollIntervalMs = options.pollIntervalMs ?? Number(process.env.MINERU_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);
    this.timeoutMs = options.timeoutMs ?? Number(process.env.MINERU_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  }

  async parse(input: { documentId: string; fileName: string; filePath: string }): Promise<ParsedDocumentResult> {
    const runDir = resolve(this.outputDir, input.documentId);
    await mkdir(runDir, { recursive: true });

    const pdfUrl = buildPdfUrl(this.pdfUrlBase, input.fileName);
    const taskId = await this.createTask(pdfUrl);
    const zipUrl = await this.waitForResult(taskId);
    const zipBuffer = await this.downloadZip(zipUrl);
    const artifacts = unzipArtifacts(zipBuffer);
    artifacts[`${taskId}.zip`] = zipBuffer;

    const markdownArtifact = findMarkdownArtifact(artifacts);
    if (!markdownArtifact) {
      throw new Error(`MinerU output did not contain full.md or another markdown file for task ${taskId}`);
    }

    return {
      markdown: markdownArtifact.toString("utf8"),
      rawArtifacts: artifacts
    };
  }

  private async createTask(pdfUrl: string): Promise<string> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}/extract/task`, {
      body: JSON.stringify({
        enable_formula: false,
        is_ocr: true,
        url: pdfUrl
      }),
      headers: this.headers(),
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(`MinerU task creation failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as MineruTaskResponse;
    const taskId = payload.data?.task_id;
    if (!taskId) {
      throw new Error("MinerU task creation response did not include data.task_id");
    }

    return taskId;
  }

  private async waitForResult(taskId: string): Promise<string> {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= this.timeoutMs) {
      const response = await this.fetchImpl(`${this.apiBaseUrl}/extract/task/${taskId}`, {
        headers: this.headers(),
        method: "GET"
      });

      if (!response.ok) {
        throw new Error(`MinerU task polling failed (${response.status}): ${await response.text()}`);
      }

      const payload = (await response.json()) as MineruTaskStatusResponse;
      const data = payload.data;

      if (data?.err_msg) {
        throw new Error(`MinerU task failed: ${data.err_msg}`);
      }

      if (data?.state === "done") {
        if (!data.full_zip_url) {
          throw new Error(`MinerU task ${taskId} finished without full_zip_url`);
        }

        return data.full_zip_url;
      }

      if (data?.state && !["pending", "running"].includes(data.state)) {
        throw new Error(`MinerU task ${taskId} returned unexpected state: ${data.state}`);
      }

      await sleep(this.pollIntervalMs);
    }

    throw new Error(`MinerU task ${taskId} timed out after ${this.timeoutMs}ms`);
  }

  private async downloadZip(zipUrl: string): Promise<Buffer> {
    const response = await this.fetchImpl(zipUrl);

    if (!response.ok) {
      throw new Error(`MinerU result zip download failed (${response.status}): ${await response.text()}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json"
    };
  }
}

function buildPdfUrl(pdfUrlBase: string, fileName: string): string {
  return `${pdfUrlBase.replace(/\/+$/, "")}/${encodeURIComponent(basename(fileName))}`;
}

function findMarkdownArtifact(artifacts: ParsedDocumentArtifactMap): Buffer | undefined {
  const preferred = Object.entries(artifacts).find(([path]) => path.endsWith("/full.md") || path === "full.md");
  const fallback = preferred ?? Object.entries(artifacts).find(([path]) => path.endsWith(".md"));
  const content = fallback?.[1];

  return Buffer.isBuffer(content) ? content : undefined;
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function unzipArtifacts(zipBuffer: Buffer): ParsedDocumentArtifactMap {
  const unzipped = unzipSync(zipBuffer);
  return Object.fromEntries(Object.entries(unzipped).map(([path, content]) => [path.replace(/\\/g, "/"), Buffer.from(content)]));
}
