/**
 * Conductor Hub Persistence — 请求历史仓库
 *
 * 复用 conductor-persistence 的 SqliteClient 基础设施，
 * 在同一个数据库中使用独立的 request_history 表。
 */

import { SqliteClient } from '@anthropic/conductor-persistence';
import type { RequestRecord } from '@anthropic/conductor-hub-shared';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS request_history (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    client_name TEXT,
    client_version TEXT,
    method TEXT NOT NULL,
    tool_name TEXT,
    model TEXT,
    duration INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    request_preview TEXT,
    response_preview TEXT,
    status TEXT NOT NULL,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_rh_timestamp ON request_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_rh_model ON request_history(model);
`;

/**
 * 请求历史仓库 — 基于 SqliteClient
 */
export class RequestHistoryRepository {
    constructor(private client: SqliteClient) {
        const db = client.getDatabase();
        db.exec(CREATE_TABLE_SQL);
    }

    /** 保存请求记录 */
    saveRecord(record: RequestRecord): void {
        const db = this.client.getDatabase();
        try {
            db.prepare(`
                INSERT OR IGNORE INTO request_history (
                    id, timestamp, client_name, client_version, method, tool_name, model,
                    duration, input_tokens, output_tokens, total_tokens, request_preview,
                    response_preview, status, error_message
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                record.id, record.timestamp, record.clientName, record.clientVersion ?? null,
                record.method, record.toolName ?? null, record.model ?? null, record.duration,
                record.inputTokens ?? null, record.outputTokens ?? null, record.totalTokens ?? null,
                (record.requestPreview || '').slice(0, 500),
                (record.responsePreview || '').slice(0, 500),
                record.status, record.errorMessage ?? null
            );
        } catch (error) {
            console.error('[Conductor Hub] Failed to save history record:', error);
        }
    }

    /** 查询历史记录 (分页) */
    queryHistory(page: number, pageSize: number): { records: RequestRecord[]; total: number } {
        const db = this.client.getDatabase();
        const offset = (page - 1) * pageSize;

        const rows = db.prepare(
            'SELECT * FROM request_history ORDER BY timestamp DESC LIMIT ? OFFSET ?'
        ).all(pageSize, offset) as Record<string, unknown>[];

        const totalRow = db.prepare(
            'SELECT COUNT(*) as count FROM request_history'
        ).get() as { count: number };

        return {
            records: rows.map(this.mapDbRow),
            total: totalRow.count,
        };
    }

    /** 清理过期记录 */
    cleanupOldRecords(daysToKeep: number = 30): void {
        const db = this.client.getDatabase();
        const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        db.prepare('DELETE FROM request_history WHERE timestamp < ?').run(cutoff);
    }

    /** 清空全部记录 */
    clearAll(): void {
        const db = this.client.getDatabase();
        db.exec('DELETE FROM request_history');
    }

    private mapDbRow(row: Record<string, unknown>): RequestRecord {
        return {
            id: row.id as string,
            timestamp: row.timestamp as number,
            clientName: row.client_name as string,
            clientVersion: row.client_version as string | undefined,
            method: row.method as string,
            toolName: row.tool_name as string | undefined,
            model: row.model as string | undefined,
            duration: row.duration as number,
            inputTokens: row.input_tokens as number | undefined,
            outputTokens: row.output_tokens as number | undefined,
            totalTokens: row.total_tokens as number | undefined,
            requestPreview: row.request_preview as string,
            responsePreview: row.response_preview as string,
            status: row.status as 'success' | 'error',
            errorMessage: row.error_message as string | undefined,
        };
    }
}
