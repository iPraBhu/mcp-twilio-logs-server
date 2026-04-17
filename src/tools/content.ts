export function makeResultText(
  tool: string,
  count: number,
  structuredContent: unknown,
  options: {
    nextCursor?: string;
  } = {},
): string {
  const summary = `${tool} returned ${count} result(s)${options.nextCursor ? "; more results are available via nextCursor." : "."}`;
  return `${summary}\n\n${JSON.stringify(structuredContent, null, 2)}`;
}
