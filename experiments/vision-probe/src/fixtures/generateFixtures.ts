import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { defaultFixtureDir } from '../config.js';

type Rgba = [number, number, number, number];

const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];
const RED: Rgba = [220, 38, 38, 255];
const BLUE: Rgba = [37, 99, 235, 255];
const GREEN: Rgba = [22, 163, 74, 255];
const YELLOW: Rgba = [250, 204, 21, 255];
const PURPLE: Rgba = [126, 34, 206, 255];
const ORANGE: Rgba = [249, 115, 22, 255];

const FONT_5X7: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
};

function createPng(width: number, height: number, fill: Rgba = WHITE): PNG {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(png, x, y, fill);
    }
  }
  return png;
}

function setPixel(png: PNG, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = color[0];
  png.data[idx + 1] = color[1];
  png.data[idx + 2] = color[2];
  png.data[idx + 3] = color[3];
}

function fillRect(png: PNG, x: number, y: number, width: number, height: number, color: Rgba): void {
  for (let yy = y; yy < y + height; yy++) {
    for (let xx = x; xx < x + width; xx++) {
      setPixel(png, xx, yy, color);
    }
  }
}

function fillCircle(png: PNG, cx: number, cy: number, radius: number, color: Rgba): void {
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        setPixel(png, x, y, color);
      }
    }
  }
}

function fillTriangle(png: PNG, p1: [number, number], p2: [number, number], p3: [number, number], color: Rgba): void {
  const minX = Math.floor(Math.min(p1[0], p2[0], p3[0]));
  const maxX = Math.ceil(Math.max(p1[0], p2[0], p3[0]));
  const minY = Math.floor(Math.min(p1[1], p2[1], p3[1]));
  const maxY = Math.ceil(Math.max(p1[1], p2[1], p3[1]));
  const area = edge(p1, p2, p3);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const pt: [number, number] = [x, y];
      const w0 = edge(p2, p3, pt);
      const w1 = edge(p3, p1, pt);
      const w2 = edge(p1, p2, pt);
      if ((area >= 0 && w0 >= 0 && w1 >= 0 && w2 >= 0) || (area < 0 && w0 <= 0 && w1 <= 0 && w2 <= 0)) {
        setPixel(png, x, y, color);
      }
    }
  }
}

function edge(a: [number, number], b: [number, number], c: [number, number]): number {
  return (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
}

function fillPolygon(png: PNG, points: Array<[number, number]>, color: Rgba): void {
  const minY = Math.floor(Math.min(...points.map((p) => p[1])));
  const maxY = Math.ceil(Math.max(...points.map((p) => p[1])));
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        intersections.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      const start = Math.ceil(intersections[i] ?? 0);
      const end = Math.floor(intersections[i + 1] ?? start);
      for (let x = start; x <= end; x++) {
        setPixel(png, x, y, color);
      }
    }
  }
}

function starPoints(cx: number, cy: number, outerRadius: number, innerRadius: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return points;
}

function drawText(png: PNG, text: string, x: number, y: number, scale: number, color: Rgba): void {
  let cursorX = x;
  for (const char of text.toUpperCase()) {
    if (char === ' ') {
      cursorX += 4 * scale;
      continue;
    }
    const glyph = FONT_5X7[char];
    if (!glyph) {
      cursorX += 6 * scale;
      continue;
    }
    for (let row = 0; row < glyph.length; row++) {
      const line = glyph[row]!;
      for (let col = 0; col < line.length; col++) {
        if (line[col] !== '1') continue;
        fillRect(png, cursorX + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursorX += 6 * scale;
  }
}

async function writePng(filePath: string, png: PNG): Promise<void> {
  await writeFile(filePath, PNG.sync.write(png));
}

export async function generateFixtures(outputDir = defaultFixtureDir): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const paths: string[] = [];

  const shapes = createPng(640, 360);
  fillCircle(shapes, 150, 170, 70, RED);
  fillRect(shapes, 285, 100, 140, 140, BLUE);
  fillTriangle(shapes, [520, 95], [440, 250], [600, 250], GREEN);
  paths.push(resolve(outputDir, 'shapes-basic.png'));
  await writePng(paths.at(-1)!, shapes);

  const spatial = createPng(640, 360);
  fillPolygon(spatial, starPoints(160, 175, 90, 38), YELLOW);
  fillRect(spatial, 410, 95, 160, 160, PURPLE);
  paths.push(resolve(outputDir, 'spatial-left-right.png'));
  await writePng(paths.at(-1)!, spatial);

  const ocr = createPng(900, 260);
  drawText(ocr, 'LokalMind 42', 60, 70, 16, BLACK);
  paths.push(resolve(outputDir, 'ocr-simple.png'));
  await writePng(paths.at(-1)!, ocr);

  const counting = createPng(640, 360);
  const dotPositions: Array<[number, number]> = [[120, 110], [210, 100], [165, 195], [285, 185], [90, 245]];
  for (const [x, y] of dotPositions) {
    fillCircle(counting, x, y, 28, BLACK);
  }
  fillRect(counting, 410, 105, 130, 55, ORANGE);
  fillRect(counting, 390, 220, 160, 60, ORANGE);
  paths.push(resolve(outputDir, 'counting-grid.png'));
  await writePng(paths.at(-1)!, counting);

  return paths;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
  const outArg = process.argv[2];
  generateFixtures(outArg ? resolve(outArg) : defaultFixtureDir)
    .then((paths) => {
      console.log(`Generated ${paths.length} fixture(s):`);
      for (const path of paths) console.log(`- ${path}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
