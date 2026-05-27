import type {
  ExpectedSignal,
  ModelVisionVerdict,
  ProbeResultRecord,
  ProbeScore,
  ScoreResult,
  TestCase,
} from '../types.js';

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function signalMatches(text: string, signal: ExpectedSignal): boolean {
  const normalized = normalize(text);
  return signal.patterns.some((pattern) => normalized.includes(normalize(pattern)));
}

export function scoreVisionAnswer(testCase: TestCase, responseText: string | null, runtimeError?: string): ScoreResult {
  if (runtimeError) {
    return { score: 'runtime_error', matchedSignals: [], forbiddenMatches: [] };
  }

  const text = responseText?.trim() ?? '';
  if (!text) {
    return { score: 'fail', matchedSignals: [], forbiddenMatches: [] };
  }

  const matchedSignals = testCase.expectedSignals
    .filter((signal) => signalMatches(text, signal))
    .map((signal) => signal.label);

  const forbiddenMatches = testCase.forbiddenSignals
    .filter((signal) => signalMatches(text, signal))
    .map((signal) => signal.label);

  let score: ProbeScore;
  if (forbiddenMatches.length > 0) {
    score = matchedSignals.length > 0 ? 'partial' : 'fail';
  } else if (matchedSignals.length >= testCase.minSignalsForPass) {
    score = 'pass';
  } else if (matchedSignals.length > 0) {
    score = 'partial';
  } else {
    score = 'fail';
  }

  return { score, matchedSignals, forbiddenMatches };
}

function scoreWeight(score: ProbeScore): number {
  switch (score) {
    case 'pass':
      return 2;
    case 'partial':
      return 1;
    case 'fail':
    case 'runtime_error':
      return 0;
  }
}

export function computeVisionVerdict(results: ProbeResultRecord[]): { verdict: ModelVisionVerdict; explanation: string } {
  const imageResults = results.filter((result) => result.withImage);
  const noImageResults = results.filter((result) => !result.withImage);

  if (imageResults.length === 0) {
    return {
      verdict: 'runtime_failed',
      explanation: 'No image probe results were recorded.',
    };
  }

  const imageRuntimeErrors = imageResults.filter((result) => result.score === 'runtime_error').length;
  const totalRuntimeErrors = results.filter((result) => result.score === 'runtime_error').length;
  if (totalRuntimeErrors === results.length) {
    return {
      verdict: 'runtime_failed',
      explanation: 'Every probe failed at runtime, so the server/model could not be evaluated.',
    };
  }

  if (imageRuntimeErrors === imageResults.length) {
    return {
      verdict: 'text_only_or_not_configured',
      explanation: 'Every image probe failed at runtime while the harness continued, which usually means image input is unsupported or the multimodal projector is missing.',
    };
  }

  const imagePasses = imageResults.filter((result) => result.score === 'pass').length;
  const imageWeighted = imageResults.reduce((sum, result) => sum + scoreWeight(result.score), 0);
  const noImageWeighted = noImageResults.reduce((sum, result) => sum + scoreWeight(result.score), 0);
  const clearlyBeatsControl = imageWeighted > noImageWeighted;

  if (imagePasses >= 3 && clearlyBeatsControl) {
    return {
      verdict: 'vision_capable',
      explanation: `Passed ${imagePasses}/${imageResults.length} image tests and outperformed the no-image control.`,
    };
  }

  if (imagePasses >= 2 && clearlyBeatsControl) {
    return {
      verdict: 'maybe_vision_capable',
      explanation: `Passed ${imagePasses}/${imageResults.length} image tests but did not reach the stronger 3-test threshold.`,
    };
  }

  return {
    verdict: 'text_only_or_not_configured',
    explanation: `Image probes passed ${imagePasses}/${imageResults.length}; results did not clearly beat no-image controls.`,
  };
}
