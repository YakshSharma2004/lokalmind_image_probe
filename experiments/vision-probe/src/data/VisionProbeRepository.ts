import type { ISQLiteDriver } from '../adapters/NodeSQLiteDriver.js';
import { computeVisionVerdict } from '../domain/scoreVisionAnswer.js';
import type { LatestRunReport, ProbeResultRecord, ProbeRun, ProbeScore } from '../types.js';

interface ProbeRunRow {
  id: string;
  model_id: string;
  model_label: string;
  server_url: string;
  server_command: string | null;
  started_at: number;
  completed_at: number | null;
  status: string;
  notes: string | null;
}

interface ProbeResultRow {
  id: string;
  run_id: string;
  test_id: string;
  image_path: string;
  prompt: string;
  with_image: number;
  response_text: string | null;
  expected_signals: string;
  forbidden_signals: string;
  score: ProbeScore;
  latency_ms: number | null;
  error: string | null;
  created_at: number;
}

export interface CreateRunParams {
  id: string;
  modelId: string;
  modelLabel: string;
  serverUrl: string;
  serverCommand: string | null;
  startedAt: number;
  notes: string | null;
}

export interface SaveResultParams {
  id: string;
  runId: string;
  testId: string;
  imagePath: string;
  prompt: string;
  withImage: boolean;
  responseText: string | null;
  expectedSignals: string;
  forbiddenSignals: string;
  score: ProbeScore;
  latencyMs: number | null;
  error: string | null;
  createdAt: number;
}

export class VisionProbeRepository {
  constructor(private readonly driver: ISQLiteDriver) {}

  async createRun(params: CreateRunParams): Promise<void> {
    await this.driver.execute(
      `INSERT INTO probe_runs (
         id, model_id, model_label, server_url, server_command, started_at, completed_at, status, notes
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'running', ?)`,
      [
        params.id,
        params.modelId,
        params.modelLabel,
        params.serverUrl,
        params.serverCommand,
        params.startedAt,
        params.notes,
      ],
    );
  }

  async completeRun(runId: string, status: string, notes: string | null): Promise<void> {
    await this.driver.execute(
      `UPDATE probe_runs SET completed_at = ?, status = ?, notes = ? WHERE id = ?`,
      [Date.now(), status, notes, runId],
    );
  }

  async saveResult(params: SaveResultParams): Promise<void> {
    await this.driver.execute(
      `INSERT INTO probe_results (
         id, run_id, test_id, image_path, prompt, with_image, response_text,
         expected_signals, forbidden_signals, score, latency_ms, error, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.id,
        params.runId,
        params.testId,
        params.imagePath,
        params.prompt,
        params.withImage ? 1 : 0,
        params.responseText,
        params.expectedSignals,
        params.forbiddenSignals,
        params.score,
        params.latencyMs,
        params.error,
        params.createdAt,
      ],
    );
  }

  async getLatestRunReport(): Promise<LatestRunReport | null> {
    const runRow = await this.driver.get<ProbeRunRow>(
      `SELECT * FROM probe_runs ORDER BY started_at DESC LIMIT 1`,
    );
    if (!runRow) return null;

    const resultRows = await this.driver.query<ProbeResultRow>(
      `SELECT * FROM probe_results WHERE run_id = ? ORDER BY test_id ASC, with_image DESC`,
      [runRow.id],
    );

    const run = this.mapRun(runRow);
    const results = resultRows.map((row) => this.mapResult(row));
    const verdict = computeVisionVerdict(results);
    return {
      run,
      results,
      verdict: verdict.verdict,
      explanation: verdict.explanation,
    };
  }

  async getRunResults(runId: string): Promise<ProbeResultRecord[]> {
    const resultRows = await this.driver.query<ProbeResultRow>(
      `SELECT * FROM probe_results WHERE run_id = ? ORDER BY test_id ASC, with_image DESC`,
      [runId],
    );
    return resultRows.map((row) => this.mapResult(row));
  }

  private mapRun(row: ProbeRunRow): ProbeRun {
    return {
      id: row.id,
      modelId: row.model_id,
      modelLabel: row.model_label,
      serverUrl: row.server_url,
      serverCommand: row.server_command,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status,
      notes: row.notes,
    };
  }

  private mapResult(row: ProbeResultRow): ProbeResultRecord {
    return {
      id: row.id,
      runId: row.run_id,
      testId: row.test_id,
      imagePath: row.image_path,
      prompt: row.prompt,
      withImage: row.with_image === 1,
      responseText: row.response_text,
      expectedSignals: row.expected_signals,
      forbiddenSignals: row.forbidden_signals,
      score: row.score,
      latencyMs: row.latency_ms,
      error: row.error,
      createdAt: row.created_at,
    };
  }
}
