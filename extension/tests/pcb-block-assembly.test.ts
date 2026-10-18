import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import PQueue from 'p-queue';
import * as symbols from '../src/eda/assembly-symbols';
import * as source from '../src/eda/source-document';
import * as refs from '../src/eda/component-part-ref';
import * as blocks from '../src/eda/pcb-block-properties';
import * as parts from '@copilot/shared/types/lcsc';

const file = resolve(__dirname, '../src/eda/assemble-source.ts');
const code = ts.transpileModule(readFileSync(file, 'utf8') + '\nexport const api = { finalizeSourceComponents };', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
}).outputText;

function fixture(failWriteFor = new Set<string>()) {
    const logs: string[] = [], done: string[] = [];
    // Cloned instances start with the seed's properties, as in the source path.
    const properties = new Map<string, Record<string, unknown>>();
    const primitive = (id: string) => ({
        toAsync: () => ({
            getState_OtherProperty: () => properties.get(id) ?? {},
            setState_OtherProperty: (value: Record<string, unknown>) => {
                if (failWriteFor.has(id)) throw new Error('write failed');
                properties.set(id, value);
            },
            setState_Name() {}, setState_Net() {},
            done: async () => { done.push(id); },
        }),
    });
    const eda = {
        sys_Log: { add: (message: string) => logs.push(message) },
        sch_PrimitiveComponent: { get: async (id: string) => primitive(id) },
        sys_FileManager: { getDocumentSource: async () => '' },
    };
    const exports: Record<string, any> = {};
    runInNewContext(code, { exports, eda, structuredClone, setTimeout, ESYS_LogType: { WARNING: 'warning' }, require(name: string) {
        if (name === 'p-queue') return { default: PQueue };
        if (name === './assembly-symbols') return symbols;
        if (name === './source-document') return source;
        if (name === './component-part-ref') return refs;
        if (name === './pcb-block-properties') return blocks;
        if (name === '@copilot/shared/types/lcsc') return parts;
        if (name === './utils') return { withTimeout: (p: Promise<unknown>) => p };
        if (name === './types') return { isNetPortUuid: () => false, shortSymbolsMap: { GND: { is: () => false }, VCC: { is: () => false } } };
        return {};
    } });
    const plan = (id: string, designator: string, block_name: string) => {
        properties.set(id, { Value: '10k', 'PCB Block': 'seed_block' });
        return { primitiveId: id, input: { designator, block_name, value: '10k', pins: [], part_uuid: 'x', pos: { rotate: 0 } } };
    };
    return { finalize: exports.api.finalizeSourceComponents as (plans: unknown[]) => Promise<void>, plan, properties, logs, done };
}

test('source assembly writes each instance its own PCB Block over the cloned seed value', async () => {
    const f = fixture();
    await f.finalize([f.plan('a', 'R1', 'buck_feedback'), f.plan('b', 'R2', 'ldo_feedback'), f.plan('c', 'R3', '__bulk_net__')]);
    assert.deepEqual(f.properties.get('a'), { Value: '10k', 'PCB Block': 'buck_feedback' });
    assert.deepEqual(f.properties.get('b'), { Value: '10k', 'PCB Block': 'ldo_feedback' });
    assert.deepEqual(f.properties.get('c'), { Value: '10k', 'PCB Block': 'seed_block' }, 'internal names are not written');
    assert.deepEqual(f.done, ['a', 'b', 'c']);
});

test('a failed PCB Block write is logged and neither fails assembly nor skips the component', async () => {
    const f = fixture(new Set(['a']));
    await f.finalize([f.plan('a', 'R1', 'buck_feedback'), f.plan('b', 'R2', 'ldo_feedback')]);
    assert.deepEqual(f.done, ['a', 'b']);
    assert.deepEqual(f.properties.get('b'), { Value: '10k', 'PCB Block': 'ldo_feedback' });
    assert.ok(f.logs.some(message => message.includes('PCB Block property not written for a')));
});
