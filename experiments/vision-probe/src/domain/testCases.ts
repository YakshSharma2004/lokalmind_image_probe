import type { TestCase } from '../types.js';

export const testCases: TestCase[] = [
  {
    id: 'shapes-basic',
    imageFile: 'shapes-basic.png',
    prompt: 'List the visible shapes and their colors.',
    expectedSignals: [
      { label: 'red circle', patterns: ['red circle', 'circle is red', 'red round'] },
      { label: 'blue square', patterns: ['blue square', 'square is blue'] },
      { label: 'green triangle', patterns: ['green triangle', 'triangle is green'] },
    ],
    forbiddenSignals: [
      { label: 'no image', patterns: ['cannot see', "can't see", 'no image', 'unable to view'] },
    ],
    minSignalsForPass: 2,
  },
  {
    id: 'spatial-left-right',
    imageFile: 'spatial-left-right.png',
    prompt: 'What object is on the left, and what object is on the right?',
    expectedSignals: [
      { label: 'left yellow star', patterns: ['left yellow star', 'yellow star on the left', 'star on the left'] },
      { label: 'right purple square', patterns: ['right purple square', 'purple square on the right', 'square on the right'] },
    ],
    forbiddenSignals: [
      { label: 'reversed spatial relation', patterns: ['left purple square', 'right yellow star', 'purple square on the left'] },
      { label: 'no image', patterns: ['cannot see', "can't see", 'no image', 'unable to view'] },
    ],
    minSignalsForPass: 2,
  },
  {
    id: 'ocr-simple',
    imageFile: 'ocr-simple.png',
    prompt: 'What exact text appears in the image?',
    expectedSignals: [
      { label: 'LokalMind', patterns: ['lokalmind', 'lokal mind'] },
      { label: '42', patterns: ['42', 'forty two', 'forty-two'] },
    ],
    forbiddenSignals: [
      { label: 'wrong app name', patterns: ['localmind'] },
      { label: 'no image', patterns: ['cannot see', "can't see", 'no image', 'unable to view'] },
    ],
    minSignalsForPass: 2,
  },
  {
    id: 'counting-grid',
    imageFile: 'counting-grid.png',
    prompt: 'How many black dots and orange rectangles are visible?',
    expectedSignals: [
      { label: '5 black dots', patterns: ['5 black dots', 'five black dots', '5 dots', 'five dots'] },
      { label: '2 orange rectangles', patterns: ['2 orange rectangles', 'two orange rectangles', '2 rectangles', 'two rectangles'] },
    ],
    forbiddenSignals: [
      { label: 'wrong dot count', patterns: ['4 black dots', 'four black dots', '6 black dots', 'six black dots'] },
      { label: 'wrong rectangle count', patterns: ['1 orange rectangle', 'one orange rectangle', '3 orange rectangles', 'three orange rectangles'] },
      { label: 'no image', patterns: ['cannot see', "can't see", 'no image', 'unable to view'] },
    ],
    minSignalsForPass: 2,
  },
];
