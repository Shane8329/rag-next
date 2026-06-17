import type { DocumentParser } from "./document-parser";
import { MineruCloudDocumentParser } from "./mineru-cloud-parser";
import { MineruCommandDocumentParser } from "./mineru-command-parser";

export function createMineruDocumentParser(): DocumentParser {
  if (process.env.MINERU_PARSER === "command") {
    return new MineruCommandDocumentParser();
  }

  return new MineruCloudDocumentParser();
}
