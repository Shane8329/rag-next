import type { RetrievalPageLike } from "./types";

export function validateRelevantPages(
  claimedPages: number[] | undefined,
  retrievalResults: RetrievalPageLike[],
  minPages = 2,
  maxPages = 8
): number[] {
  const normalizedClaims = claimedPages ?? [];
  const retrievedPages = retrievalResults.map((result) => result.page);
  const validatedPages = normalizedClaims.filter((page) => retrievedPages.includes(page));

  if (validatedPages.length < minPages) {
    for (const result of retrievalResults) {
      if (!validatedPages.includes(result.page)) {
        validatedPages.push(result.page);
      }

      if (validatedPages.length >= minPages) {
        break;
      }
    }
  }

  return validatedPages.slice(0, maxPages);
}
