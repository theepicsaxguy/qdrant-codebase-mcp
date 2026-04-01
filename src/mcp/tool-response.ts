export interface TextToolResponse {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
}

export function buildTextResponse(text: string, isError = false): TextToolResponse {
  const content: TextToolResponse['content'] = [{ type: 'text', text }];

  if (isError) {
    return { content, isError: true };
  }

  return { content };
}
