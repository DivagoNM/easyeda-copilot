import type { RoutingDiagnostic, RoutingResult } from 'eda-copilot-router';

const brief = (values: Readonly<Record<string, unknown>>) => Object.entries(values)
    .flatMap(([key, value]) => {
        if (typeof value === 'number') return [`${key}=${Number(value.toPrecision(5))}`];
        if (typeof value === 'string' || typeof value === 'boolean') return [`${key}=${value}`];
        return [];
    }).join(', ');

/** Human/LLM digest only. The caller always saves the unabridged report. */
export function formatRoutingReport(result: RoutingResult, diagnostics: readonly RoutingDiagnostic[],
    applied?: Record<string, unknown>) {
    const report = result.validation;
    const lines = [`Routing: ${result.status}; applied: ${applied?.applied === true}`,
        `Open nets: ${result.metrics.openNetCount ?? 'unknown'}; elapsed: ${(result.metrics.elapsedMs / 1000).toFixed(1)} s`,
        `Native DRC: ${applied?.nativeVerification ?? 'not run'}`];
    const pours = applied?.pours as { pending?: number } | undefined;
    if (pours?.pending) lines.push(`Pours awaiting native rebuild: ${pours.pending}`);
    if (report) lines.push(`Requirements: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.incomplete} unchecked`);
    const groups = new Map<string, { status: string; code: string; message: string; count: number; nets: Set<string>; example?: string }>();
    const add = (status: string, code: string, message: string, nets: string[], example?: string) => {
        const key = `${status}:${code}`;
        const entry = groups.get(key) ?? { status, code, message, count: 0, nets: new Set<string>(), example };
        entry.count++;
        nets.forEach(net => entry.nets.add(net));
        groups.set(key, entry);
    };
    for (const finding of report?.findings ?? []) {
        const example = [finding.location && `at (${finding.location.x.toFixed(3)}, ${finding.location.y.toFixed(3)}) mm`,
            finding.measured && `measured: ${brief(finding.measured)}`,
            finding.expected && `required: ${brief(finding.expected)}`].filter(Boolean).join('; ');
        add(finding.status, finding.code, finding.message, finding.objects.flatMap(o => o.net ? [o.net] : []), example);
    }
    for (const diagnostic of diagnostics) if (diagnostic.severity !== 'info')
        add(diagnostic.severity, diagnostic.code, diagnostic.message, []);
    const problems = [...groups.values()];
    for (const problem of problems.slice(0, 30)) {
        const nets = [...problem.nets];
        lines.push(`- ${problem.status} ${problem.code} (${problem.count})${nets.length ? ` [${nets.slice(0, 5).join(', ')}${nets.length > 5 ? ', …' : ''}]` : ''}: ${problem.message}${problem.example ? ` ${problem.example}` : ''}`);
    }
    if (problems.length > 30) lines.push(`${problems.length - 30} more problem groups in the full report.`);
    return lines.join('\n');
}
