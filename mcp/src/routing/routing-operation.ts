import { TIMEOUT_POLICY } from '@copilot/shared/timeout-policy';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
    compileRoutingDsl,
    createBundledEasyEdaWasmBackend,
    run,
    type RoutingDiagnostic,
    type RoutingResult,
} from 'eda-copilot-router';
import { PcbDrcBundleSchema, type PcbDrcBundle } from '@copilot/shared/types/pcb/drc.js';
import type { Bridge } from '../bridge';
import { operationManager, type OperationContext } from '../operations/manager';
import { TEMP_DIR } from '../utils/dirs';
import { formatRoutingReport } from './routing-report';
export { formatRoutingReport } from './routing-report';
import {
    importEasyEdaAutorouteJson,
    routingResultToEasyEdaApplication,
} from './easyeda-autoroute-adapter';
import {
    diffRoutingRules,
    mergeEasyEdaDrcIntoRoutingRules,
    routingRulesToEasyEdaDrcBundle,
    routingZonesToEasyEdaDrcBundle,
} from './easyeda-drc-adapter';

const PCB_DOCUMENT_RESOURCE = 'current-pcb-document';
const ROUTER_TIMEOUT_MS = TIMEOUT_POLICY.routerExecutionMs;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : undefined;
}

function diagnosticsMessage(diagnostics: readonly RoutingDiagnostic[]) {
    return diagnostics
        .filter(item => item.severity === 'error')
        .map(item => `${item.code}: ${item.message}`)
        .join('\n');
}

function adapterErrors(result: RoutingResult, diagnostics: readonly RoutingDiagnostic[]) {
    return diagnostics.slice(result.diagnostics.length).filter(item => item.severity === 'error');
}

/** Partial routing carries applicable copper; only a terminal router failure blocks the transaction. */
export function routingResultBlocksApplication(result: Pick<RoutingResult, 'status'>) {
    return result.status === 'error';
}

async function executeRoutingOperation(
    bridge: Bridge,
    dslFile: string,
    context: OperationContext,
) {
    const artifactsDirectory = join(TEMP_DIR, 'copilot-router', context.id.replace(':', '-'));

    await mkdir(artifactsDirectory, { recursive: true });
    const reportPath = join(artifactsDirectory, 'validation-report.json');
    try {

    context.setStage('reading_dsl');
    const dslPath = resolve(dslFile);
    const dsl = await readFile(dslPath, 'utf8');
    const program = compileRoutingDsl(dsl);
    await writeFile(join(artifactsDirectory, 'routing.dsl.js'), dsl);
    context.signal.throwIfAborted();

    context.setStage('exporting');
    const capture = record(await bridge.requestEasyEda('export-routing-input', {}));
    const source = typeof capture?.text === 'string' ? capture.text : '';
    if (!capture || !source) throw new Error('EasyEDA returned empty autoroute JSON.');
    await writeFile(join(artifactsDirectory, 'easyeda-routing-input.json'), source);
    const nativeDrc = PcbDrcBundleSchema().parse(capture.drc) as PcbDrcBundle;
    await writeFile(
        join(artifactsDirectory, 'easyeda-drc-input.json'),
        `${JSON.stringify(nativeDrc)}\n`,
    );
    context.signal.throwIfAborted();

    context.setStage('importing');
    const imported = importEasyEdaAutorouteJson(JSON.parse(source) as unknown, {
        ...(program.clearRouting ? { clearRouting: program.clearRouting } : {}),
    });
    if (!imported.board) {
        throw new Error(`EasyEDA routing import failed:\n${diagnosticsMessage(imported.diagnostics)}`);
    }

    const sourceRules = mergeEasyEdaDrcIntoRoutingRules(nativeDrc, imported.board.rules);
    const routerInput = {
        board: { ...imported.board, rules: sourceRules },
        dsl: program,
    };
    await writeFile(
        join(artifactsDirectory, 'copilot-router-input.json'),
        `${JSON.stringify(routerInput)}\n`,
    );

    context.setStage('routing');
    const backend = createBundledEasyEdaWasmBackend({
        onProgress: value => context.setProgress({ message: 'WASM routing', details: { progress: value } }),
    });
    const routingTimeout = AbortSignal.timeout(ROUTER_TIMEOUT_MS);
    const routingSignal = AbortSignal.any([
        context.signal,
        routingTimeout,
    ]);
    const result = await run({
        ...routerInput,
        backend,
        signal: routingSignal,
        onCheckpoint: async ({ phase, board }) => {
            context.setStage(phase);
            await writeFile(join(artifactsDirectory, `${phase}.json`), JSON.stringify(board));
        },
    });
    await writeFile(
        join(artifactsDirectory, 'routing-result.json'),
        `${JSON.stringify(result)}\n`,
    );
    const saveReport = async (extra: Record<string, unknown> = {}) => writeFile(reportPath,
        JSON.stringify({ status: result.status, validation: result.validation ?? null,
            diagnostics: [...imported.diagnostics, ...result.diagnostics], metrics: result.metrics, ...extra }, null, 2));
    await saveReport();
    // A watchdog-expired router run may still return independently audited,
    // applicable partial copper. Only an explicit operation cancellation may
    // veto that result after run(); status:error is handled below.
    context.signal.throwIfAborted();
    const routingErrors = result.diagnostics.filter(item => item.severity === 'error');
    if (routingResultBlocksApplication(result)) {
        throw new Error(`${diagnosticsMessage(routingErrors) || 'PCB router DSL failed.'}\nFull report: ${reportPath}`);
    }

    context.setStage('preparing_application');
    const translatedApplication = routingResultToEasyEdaApplication(result);
    const unsupported = adapterErrors(result, translatedApplication.diagnostics);
    if (unsupported.length) {
        await saveReport({ diagnostics: [...imported.diagnostics, ...translatedApplication.diagnostics] });
        throw new Error(`${diagnosticsMessage(unsupported)}\nFull report: ${reportPath}`);
    }
    // Import warnings describe native source objects that were deliberately
    // skipped. Preserve them in the operation result and its artifact instead
    // of losing them when the router returns successfully.
    const application = {
        ...translatedApplication,
        diagnostics: [...imported.diagnostics, ...translatedApplication.diagnostics],
    };
    await writeFile(
        join(artifactsDirectory, 'easyeda-routing-application.json'),
        `${JSON.stringify(application)}\n`,
    );
    const shouldApplyDrc = result.operation === 'apply-drc' || result.operation === 'all';
    const ruleChanges = diffRoutingRules(sourceRules, result.rules);
    const zonesWithDrc = application.zones.filter(zone => (
        zone.clearanceMm !== undefined || zone.connection !== undefined || zone.padConnection !== undefined
    ));
    let bundle = shouldApplyDrc && ruleChanges.hasChanges
        ? routingRulesToEasyEdaDrcBundle(nativeDrc, sourceRules, result.rules)
        : undefined;
    if (zonesWithDrc.length) {
        bundle = routingZonesToEasyEdaDrcBundle(bundle ?? nativeDrc, zonesWithDrc);
    }
    context.signal.throwIfAborted();

    context.setStage('applying');
    context.setApplyHandler(async () => {
        const applied = record(await bridge.requestEasyEda('apply-routing-result', {
            operationId: context.id,
            application,
            ...(bundle ? { bundle } : {}),
        }));
        if (!applied || applied.applied !== true) {
            throw new Error('EasyEDA did not confirm the routing transaction.');
        }
        return applied;
    });
    let applied: JsonRecord | undefined;
    try { applied = record(await context.applyResult()); }
    catch (error) {
        await saveReport({ diagnostics: application.diagnostics, applicationError: String(error) });
        throw new Error(`${String(error)}\nFull report: ${reportPath}`);
    }
    const pours = record(applied?.pours);
    const status = result.status === 'complete' && (applied?.nativeVerification === 'failed' || Number(pours?.pending ?? 0) > 0)
        ? 'partial' : result.status;
    await saveReport({ status, diagnostics: application.diagnostics, application: applied });
    return {
        status,
        operation_id: context.id,
        applied: applied?.applied === true,
        checkpointId: applied?.checkpointId,
        content: formatRoutingReport({ ...result, status }, application.diagnostics, applied),
        report_path: reportPath,
        artifacts_directory: artifactsDirectory,
    };
    } catch (error) {
        // Also retain evidence when compilation, export or import fails before
        // the router can produce a validation report.
        let previous: JsonRecord = {};
        try { previous = JSON.parse(await readFile(reportPath, 'utf8')); } catch {}
        await writeFile(reportPath, JSON.stringify({ ...previous, status: 'error',
            validation: previous.validation ?? null, operationError: String(error) }, null, 2));
        const message = String(error);
        throw new Error(message.includes(reportPath) ? message : `${message}\nFull report: ${reportPath}`);
    }
}

export async function runPcbRouterDsl(
    bridge: Bridge,
    dslFile: string,
    waitMs: number = TIMEOUT_POLICY.mutationWaitMs,
) {
    const operationId = operationManager.start(
        'pcb-dsl',
        context => executeRoutingOperation(bridge, dslFile, context),
        { resource: PCB_DOCUMENT_RESOURCE, tool: 'run_pcb_router_dsl' },
    );
    return operationManager.wait(operationId, waitMs);
}
