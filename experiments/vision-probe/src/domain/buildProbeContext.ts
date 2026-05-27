import type { ProbeMessage, TestCase } from '../types.js';

export const deterministicSystemPrompt =
  'You are a precise visual inspection assistant. Answer only from the provided image. Keep the answer short and literal.';

export function buildProbeContext(testCase: TestCase, imagePath?: string): ProbeMessage[] {
  return [
    { role: 'system', content: deterministicSystemPrompt },
    {
      role: 'user',
      content: testCase.prompt,
      ...(imagePath ? { imagePath } : {}),
    },
  ];
}
