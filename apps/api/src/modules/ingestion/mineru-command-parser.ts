import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DocumentParser, ParsedDocumentArtifactMap, ParsedDocumentResult } from "./document-parser";

const execFileAsync = promisify(execFile);

export interface MineruCommandDocumentParserOptions {
  command?: string;
  argsTemplate?: string[];
  outputDir?: string;
  timeoutMs?: number;
}

export class MineruCommandDocumentParser implements DocumentParser {
  private readonly command: string;
  private readonly argsTemplate: string[];
  private readonly outputDir: string;
  private readonly timeoutMs: number;

  constructor(options: MineruCommandDocumentParserOptions = {}) {
    this.command = options.command ?? process.env.MINERU_COMMAND ?? "mineru";
    this.argsTemplate = options.argsTemplate ?? (process.env.MINERU_ARGS_TEMPLATE ? parseTemplate(process.env.MINERU_ARGS_TEMPLATE) : ["-p", "{input}", "-o", "{output}"]);
    this.outputDir = options.outputDir ?? process.env.MINERU_OUTPUT_DIR ?? join(process.cwd(), ".tmp", "mineru");
    this.timeoutMs = options.timeoutMs ?? Number(process.env.MINERU_TIMEOUT_MS ?? 300000);
  }

  async parse(input: { documentId: string; fileName: string; filePath: string }): Promise<ParsedDocumentResult> {
    const runDir = resolve(this.outputDir, input.documentId);
    await mkdir(runDir, { recursive: true });

    const args = this.argsTemplate.map((arg) =>
      arg
        .replaceAll("{input}", input.filePath)
        .replaceAll("{output}", runDir)
        .replaceAll("{fileName}", input.fileName)
        .replaceAll("{documentId}", input.documentId)
    );

    try {
      await execFileAsync(this.command, args, {
        timeout: this.timeoutMs,
        windowsHide: true
      });
    } catch (error) {
      if (isCommandNotFoundError(error)) {
        throw new Error(
          `MinerU command not found: "${this.command}". Install MinerU or set MINERU_COMMAND to an absolute executable path.`,
          { cause: error }
        );
      }

      throw error;
    }

    const artifacts = await collectArtifacts(runDir);
    const markdownPath = findMarkdownPath(artifacts, runDir);

    if (!markdownPath) {
      throw new Error(`MinerU output did not contain a markdown file under ${runDir}`);
    }

    return {
      markdown: await readFile(markdownPath, "utf8"),
      rawArtifacts: artifacts
    };
  }
}

async function collectArtifacts(rootDir: string): Promise<ParsedDocumentArtifactMap> {
  const artifacts: ParsedDocumentArtifactMap = {};
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    for (const entry of await readdir(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      artifacts[fullPath.slice(rootDir.length + 1).replace(/\\/g, "/")] = await readFile(fullPath);
    }
  }

  return artifacts;
}

function findMarkdownPath(artifacts: ParsedDocumentArtifactMap, rootDir: string): string | undefined {
  const preferred = Object.keys(artifacts).find((path) => path.endsWith("/full.md") || path === "full.md");
  if (preferred) {
    return join(rootDir, preferred);
  }

  const firstMarkdown = Object.keys(artifacts).find((path) => path.endsWith(".md"));
  return firstMarkdown ? join(rootDir, firstMarkdown) : undefined;
}

function parseTemplate(value: string): string[] {
  return value
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function isCommandNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
