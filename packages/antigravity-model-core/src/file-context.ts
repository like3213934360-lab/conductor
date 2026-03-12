/**
 * Antigravity Workflow Core — 文件上下文注入
 *
 * 读取本地文件内容，格式化为系统提示词上下文块。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FileContextResult } from '@anthropic/antigravity-model-shared';

const MAX_FILE_BYTES = 200 * 1024;      // 200 KB 每文件
const MAX_TOTAL_BYTES = 1024 * 1024;    // 1 MB 总计

/**
 * 读取文件路径列表，格式化为上下文块。
 *
 * 支持: ~ 展开、相对路径、大小限制、安全检查
 */
export function buildFileContext(filePaths: string[]): FileContextResult {
    const sections: string[] = [];
    const warnings: string[] = [];
    let totalBytes = 0;

    const homeDir = os.homedir();

    for (const rawPath of filePaths) {
        try {
            const absPath = rawPath.startsWith('~')
                ? path.join(homeDir, rawPath.slice(1))
                : path.resolve(rawPath);

            const normalized = path.normalize(absPath);

            if (!fs.existsSync(normalized)) {
                warnings.push(`File not found: ${rawPath}`);
                continue;
            }

            const stat = fs.statSync(normalized);
            if (!stat.isFile()) {
                warnings.push(`Not a file: ${rawPath}`);
                continue;
            }
            if (stat.size > MAX_FILE_BYTES) {
                warnings.push(`Skipped (too large, >${MAX_FILE_BYTES / 1024}KB): ${rawPath}`);
                continue;
            }

            totalBytes += stat.size;
            if (totalBytes > MAX_TOTAL_BYTES) {
                warnings.push(`Stopped reading files: total size limit (${MAX_TOTAL_BYTES / 1024}KB) exceeded`);
                break;
            }

            const content = fs.readFileSync(normalized, 'utf8');
            const displayName = path.basename(normalized);

            sections.push(`=== FILE: ${displayName} ===\n${content.trimEnd()}\n=== END FILE ===`);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            warnings.push(`Error reading ${rawPath}: ${msg}`);
        }
    }

    return {
        context: sections.length > 0
            ? `The following file(s) have been provided as context:\n\n${sections.join('\n\n')}`
            : '',
        warnings,
    };
}
