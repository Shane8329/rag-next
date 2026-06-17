const fs = require("node:fs");
const path = require("node:path");

function readArg(shortName, longName) {
  const shortIndex = process.argv.indexOf(shortName);
  if (shortIndex >= 0) {
    return process.argv[shortIndex + 1];
  }

  const longIndex = process.argv.indexOf(longName);
  if (longIndex >= 0) {
    return process.argv[longIndex + 1];
  }

  return undefined;
}

const inputPath = readArg("-p", "--path");
const outputDir = readArg("-o", "--output");

if (!inputPath || !outputDir) {
  console.error("Usage: node scripts/fake-mineru.cjs -p <input.pdf> -o <output-dir>");
  process.exit(1);
}

const artifactDir = path.join(outputDir, "fake", "auto");
const originalName = path.basename(inputPath);
const markdown = [
  "# Fake MinerU Parsed Report",
  "",
  `原始文件：${originalName}`,
  "",
  "中芯国际2024全年销售收入为人民币578亿元。",
  "该内容用于本地验收上传、切分、embedding、入库和 QA 检索链路。",
  "",
  "## 经营摘要",
  "公司持续推进产能建设，成熟制程与特色工艺业务保持发展。"
].join("\n");

fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(path.join(artifactDir, "full.md"), markdown, "utf8");
fs.writeFileSync(
  path.join(artifactDir, "content_list.json"),
  JSON.stringify([{ type: "text", text: markdown, page_idx: 0 }], null, 2),
  "utf8"
);
