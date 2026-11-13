export const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]>;
export function checkTopics(
  topics: ReadonlyArray<{
    id: string;
    title: string;
    body: string;
    headings?: ReadonlyArray<{ id: string }>;
  }>,
): string[];
