export function matchCompaniesFromQuestion(questionText: string, companyNames: string[]): string[] {
  const orderedNames = [...companyNames].sort((left, right) => right.length - left.length);
  let remainingText = questionText;
  const matched: string[] = [];

  for (const companyName of orderedNames) {
    if (remainingText.includes(companyName)) {
      matched.push(companyName);
      remainingText = remainingText.replaceAll(companyName, " ");
    }
  }

  return matched;
}
