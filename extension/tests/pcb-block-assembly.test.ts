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
import * as groups from '../src/eda/schematic-groups';

const file = resolve(__dirname, '../src/eda/assemble-source.ts');
const code = ts.transpileModule(readFileSync(file, 'utf8') + `
export const api = { groupPlans, placeSeeds, collectComponentTemplates, cloneComponentsIntoSource,
    cacheTemplatesFromCurrentPage, finalizeSourceComponents, planComponents };`, {
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
        properties.set(id, { Value: '10k' });
        return { primitiveId: id, input: { designator, block_name, value: '10k', pins: [], part_uuid: 'x', pos: { rotate: 0 } } };
    };
    return { finalize: exports.api.finalizeSourceComponents as (plans: unknown[]) => Promise<void>, plan, properties, logs, done };
}

test('source assembly writes each instance its own PCB Block', async () => {
    const f = fixture();
    await f.finalize([f.plan('a', 'R1', 'buck_feedback'), f.plan('b', 'R2', 'ldo_feedback'), f.plan('c', 'R3', '__bulk_net__')]);
    assert.deepEqual(f.properties.get('a'), { Value: '10k', 'PCB Block': 'buck_feedback' });
    assert.deepEqual(f.properties.get('b'), { Value: '10k', 'PCB Block': 'ldo_feedback' });
    assert.deepEqual(f.properties.get('c'), { Value: '10k' }, 'internal names are not written');
    assert.deepEqual(f.done, ['a', 'b', 'c']);
});

test('a failed PCB Block write is logged and neither fails assembly nor skips the component', async () => {
    const f = fixture(new Set(['a']));
    await f.finalize([f.plan('a', 'R1', 'buck_feedback'), f.plan('b', 'R2', 'ldo_feedback')]);
    assert.deepEqual(f.done, ['a', 'b']);
    assert.deepEqual(f.properties.get('b'), { Value: '10k', 'PCB Block': 'ldo_feedback' });
    assert.ok(f.logs.some(message => message.includes('PCB Block property not written for a')));
});

const PART = '3a6c559f43b44aff962dd7571d5f44ee';
const CORE = new Set(['Designator', 'Device', 'Symbol', 'Footprint', 'Unique ID']);

/** The real copy chain of the source path. OtherProperty is a component's non-core ATTR records, as in EasyEDA. */
function cloneFixture() {
    let records: any[] = [];
    const attrsOf = (id: string) => Object.fromEntries(records
        .filter(r => r.outer.type === 'ATTR' && r.inner?.parentId === id && !CORE.has(String(r.inner.key)))
        .map(r => [r.inner.key, r.inner.value]));
    const primitive = (id: string): any => ({
        getState_PrimitiveId: () => id, getState_Component: () => ({ uuid: PART }), getState_X: () => 0, getState_Y: () => 0,
        getState_OtherProperty: () => attrsOf(id),
        toAsync() {
            let pending: Record<string, unknown> | undefined;
            return {
                getState_OtherProperty: () => pending ?? attrsOf(id),
                setState_OtherProperty: (value: Record<string, unknown>) => { pending = value; },
                setState_Name() {}, setState_Net() {},
                done: async () => {
                    if (!pending) return;
                    records = records.filter(r => !(r.outer.type === 'ATTR' && r.inner?.parentId === id && !CORE.has(String(r.inner.key))));
                    for (const [key, value] of Object.entries(pending)) records.push({ outer: { type: 'ATTR', id: `${id}-${key}` }, inner: { parentId: id, key, value } });
                },
            };
        },
    });
    const eda: any = {
        sys_Log: { add() {} }, sys_Environment: { isOnlineMode: () => true },
        sch_PrimitiveComponent: {
            getAll: async () => [...new Set(records.filter(r => r.outer.type === 'COMPONENT').map(r => r.outer.id))].map(id => primitive(id as string)),
            get: async (id: string) => records.some(r => r.outer.type === 'COMPONENT' && r.outer.id === id) ? primitive(id) : undefined,
        },
        sys_FileManager: { getDocumentSource: async () => source.serializeDocumentSource(records) },
    };
    const exports: Record<string, any> = {};
    runInNewContext(code, { exports, eda, structuredClone, setTimeout, crypto, ESYS_LogType: { WARNING: 'w', INFO: 'i' }, require(name: string) {
        if (name === 'p-queue') return { default: PQueue };
        if (name === './assembly-symbols') return symbols;
        if (name === './source-document') return source;
        if (name === './component-part-ref') return refs;
        if (name === './pcb-block-properties') return blocks;
        if (name === '@copilot/shared/types/lcsc') return parts;
        if (name === './place-component') return { placeComponent: async () => { throw new Error('no import expected'); }, getLibraryUuidList: async () => ['lcsc'] };
        if (name === './utils') return { to2: (v: number) => v, rmPartFromDesignator: (v: string) => v.replace(/\.\d+$/, ''), withTimeout: (p: Promise<unknown>) => p };
        if (name === './types') return { isNetPortUuid: () => false, shortSymbolsMap: { GND: { is: () => false }, VCC: { is: () => false } } };
        return {};
    } });
    const addExisting = (id: string, designator: string, other: Record<string, unknown>) => {
        records.push({ outer: { type: 'COMPONENT', id }, inner: { x: 0, y: 0, rotation: 0, isMirror: false } });
        for (const [key, value] of Object.entries({ Designator: designator, Device: 'dev', 'Unique ID': `uid-${id}`, ...other }))
            records.push({ outer: { type: 'ATTR', id: `${id}-${key}` }, inner: { parentId: id, key, value } });
    };
    const assemble = async (components: any[]) => {
        const plans = exports.api.planComponents({ components }, { x: 0, y: 0 });
        const planned = exports.api.groupPlans(plans);
        const cached = await exports.api.cacheTemplatesFromCurrentPage(planned, 'project', records);
        const seeded = await exports.api.placeSeeds(planned, 'project');
        const templates = exports.api.collectComponentTemplates(records, planned, 'project', seeded);
        records = source.parseDocumentSource(exports.api.cloneComponentsIntoSource(source.serializeDocumentSource(records), records, planned, templates).source);
        await exports.api.finalizeSourceComponents(plans);
        return { plans, cached };
    };
    return { addExisting, assemble, attrsOf, newPage() { records = [{ outer: { type: 'DOCHEAD', id: 'head' }, inner: {} }]; } };
}
const resistor = (designator: string, block_name: string) => ({ designator, block_name, value: '10k', pins: [], part_uuid: PART,
    search_query: '', pos: { x: 0, y: 0, width: 0, height: 0, center: { x: 0, y: 0 }, rotate: 0 } });

test('a copy of a declared page component gets only its own PCB Block', async () => {
    const f = cloneFixture();
    f.addExisting('r1', 'R1', { Value: '10k', 'PCB Block': 'buck_feedback', 'PCB Module': 'buck', 'PCB Attach': 'buck_core', 'PCB Role': 'power' });
    const { plans, cached } = await f.assemble([resistor('R5', 'ldo_feedback')]);
    assert.equal(cached, 1, 'the template is the page component R1');
    assert.deepEqual(f.attrsOf(plans[0].primitiveId), { Value: '10k', 'PCB Block': 'ldo_feedback' });
    assert.deepEqual(f.attrsOf('r1')['PCB Module'], 'buck', 'the original keeps its declarations');
    const read = await groups.getSchematicGroups({ wires: [], components: [
        { designator: 'R1', x: 0, y: 0, pins: [], pcb: blocks.readPcbDeclaration(f.attrsOf('r1')) },
        { designator: 'R5', x: 500, y: 0, pins: [], pcb: blocks.readPcbDeclaration(f.attrsOf(plans[0].primitiveId)) },
    ] });
    assert.deepEqual(read.declared_modules, [{ name: 'buck', blocks: ['buck_feedback'] }]);
});

test('a copy without a writable block_name gets no PCB Block from its template', async () => {
    const f = cloneFixture();
    f.addExisting('r1', 'R1', { 'PCB Block': 'buck_feedback' });
    const { plans } = await f.assemble([resistor('R6', '')]);
    assert.equal(f.attrsOf(plans[0].primitiveId)['PCB Block'], undefined);
});

test('a template cached on one page does not carry declarations to another page', async () => {
    const f = cloneFixture();
    f.addExisting('r1', 'R1', { 'PCB Block': 'buck_feedback', 'PCB Module': 'buck', 'PCB Role': 'power' });
    await f.assemble([resistor('R5', 'ldo_feedback')]);
    f.newPage();
    const { plans } = await f.assemble([resistor('R7', 'usb_cc')]);
    assert.deepEqual(f.attrsOf(plans[0].primitiveId), { 'PCB Block': 'usb_cc' });
});
