export function makeResultText(
  tool: string,
  count: number,
  options: {
    nextCursor?: string;
  } = {},
): string {
  return `${tool} returned ${count} result(s)${options.nextCursor ? "; more results are available via nextCursor." : "."}`;
}
