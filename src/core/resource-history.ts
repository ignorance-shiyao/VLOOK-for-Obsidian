import type { LinkAuditResult } from './link-audit';

/** 仅保留本次插件运行期间最近十个文档快照，避免虚拟化卸载掩盖已观察到的故障。 */
export class ResourceFailureHistory {
    private snapshots = new Map<string, {path: string; source: string; failures: Map<string, LinkAuditResult>}>();
    private identity(path: string, source: string) { return JSON.stringify([path, source]); }
    record(path: string, source: string, result: LinkAuditResult): void {
        const id = this.identity(path, source);
        let snapshot = this.snapshots.get(id);
        if (!snapshot) snapshot = {path, source, failures: new Map()};
        snapshot.failures.set(JSON.stringify([result.link.line, result.link.href]), result);
        if (snapshot.failures.size > 500) snapshot.failures.delete(snapshot.failures.keys().next().value!);
        this.snapshots.delete(id); this.snapshots.set(id, snapshot);
        if (this.snapshots.size > 10) this.snapshots.delete(this.snapshots.keys().next().value!);
    }
    recovered(path: string, source: string, line: number, href: string): void {
        this.snapshots.get(this.identity(path, source))?.failures.delete(JSON.stringify([line, href]));
    }
    results(path: string, source: string): LinkAuditResult[] {
        return Array.from(this.snapshots.get(this.identity(path, source))?.failures.values() || [], result => ({
            ...result, link: {...result.link}, detail: '上次渲染加载失败，尚未确认恢复（仅保留最近快照的故障，不代表全文检查）',
        }));
    }
    clear(): void { this.snapshots.clear(); }
}
