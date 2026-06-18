const CHINESE_TEXT_RE = /[\u4e00-\u9fff]+/g;
const LATIN_OR_DIGIT_TEXT_RE = /[a-z0-9]+/g;

function normalizeRetrievalText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, " ")
    .replace(/([0-9]+)(年|年度|月|日|季度|季|期)(?=[\u4e00-\u9fff])/gu, "$1 $2 ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildKeywordLexemes(text: string): string[] {
  const normalized = normalizeRetrievalText(text);

  if (!normalized) {
    return [];
  }

  const ordered = new Set<string>();

  const chineseBlocks = normalized.match(CHINESE_TEXT_RE) ?? [];

  for (const block of chineseBlocks) {
    if (block.length >= 2) {
      for (let index = 0; index < block.length - 1; index += 1) {
        ordered.add(block.slice(index, index + 2));
      }
    }
  }

  for (const block of chineseBlocks) {
    if (block.length >= 4 && block.length <= 12) {
      ordered.add(block);
    }
  }

  for (const token of normalized.match(LATIN_OR_DIGIT_TEXT_RE) ?? []) {
    ordered.add(token);
  }

  return [...ordered];
}

export function buildKeywordLexemeString(text: string, maxTerms = 120): string {
  return buildKeywordLexemes(text).slice(0, maxTerms).join(" ");
}

export function buildKeywordTsQueryString(text: string, maxTerms = 120): string {
  return buildKeywordLexemes(text)
    .slice(0, maxTerms)
    .map((lexeme) => `${lexeme}:*`)
    .join(" | ");
}
