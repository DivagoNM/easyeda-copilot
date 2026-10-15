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
import * as parts from '@copilot/shared/types/lcsc';
import { normalizeMultipartSourceDesignators } from '../src/eda/multipart-source-designator';

const file = resolve(__dirname, '../src/eda/assemble-source.ts');
const code = ts.transpileModule(readFileSync(file, 'utf8') + `
export const api = { groupPlans, placeSeeds, collectComponentTemplates, cloneComponentsIntoSource,
    cacheTemplatesFromCurrentPage, resolveMultipartSubPartNames };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
}).outputText;
const part = '3a6c559f43b44aff962dd7571d5f44ee';

function fixture() {
    let imports = 0;
    let records: source.SourceRecord[] = [];
    const primitives: any[] = [];
    const exports: Record<string, any> = {};
    const create = async (_ref: unknown, position: any) => {
        const id = `seed-${++imports}`;
        const attrs: Record<string, unknown> = {
            Device: `device-${imports}`, Symbol: `symbol-${imports}`, Footprint: `footprint-${imports}`,
            Designator: 'U99', 'Unique ID': `uid-${imports}`,
        };
        let other: Record<string, unknown> = {};
        const primitive = {
            getState_PrimitiveId: () => id,
            getState_Component: () => ({ uuid: attrs.Device }),
            getState_X: () => position.x, getState_Y: () => position.y,
            getState_SubPartName: () => position.subPartName,
            getState_OtherProperty: () => other,
            setState_OtherProperty: (value: Record<string, unknown>) => { other = value; },
            setState_Designator: (value: string) => { attrs.Designator = value; return primitive; },
            done: async () => {
                records.push({ outer: { type: 'COMPONENT', id }, inner: {
                    partId: position.subPartName, x: position.x, y: -position.y, rotation: 0, isMirror: false,
                } });
                for (const [key, value] of Object.entries(attrs)) records.push({
                    outer: { type: 'ATTR', id: `${id}-${key}` }, inner: { parentId: id, key, value },
                });
                primitives.push(primitive);
                return primitive;
            },
        };
        return primitive;
    };
    const eda = {
        sys_Log: { add() {} },
        sch_PrimitiveComponent: { getAll: async () => primitives },
        lib_Device: { get: async () => ({ subPartNames: ['LM358DR.1', 'LM358DR.2'] }) },
    };
    runInNewContext(code, { exports, eda, structuredClone, setTimeout, ESYS_LogType: {}, require(name: string) {
        if (name === 'p-queue') return { default: PQueue };
        if (name === './assembly-symbols') return symbols;
        if (name === './source-document') return source;
        if (name === './component-part-ref') return refs;
        if (name === '@copilot/shared/types/lcsc') return parts;
        if (name === './place-component') return { placeComponent: create, getLibraryUuidList: async () => ['lcsc'] };
        if (name === './utils') return { to2: (v: number) => v,
            rmPartFromDesignator: (v: string) => v.replace(/\.\d+$/, ''), withTimeout: (p: Promise<unknown>) => p };
        if (name === './types') return { isNetPortUuid: () => false };
        return {};
    } });
    const plan = (designator: string, libraryUuid = 'lcsc') => {
        const input = { designator, part_uuid: { uuid: part, libraryUuid }, value: 'LM358DR',
            sub_part_name: `LM358DR.${designator.split('.')[1]}`, pos: { rotate: 0 }, pins: [] } as any;
        return { input, templateKey: symbols.getComponentTemplateKey(input), apiX: 100, apiY: 200 };
    };
    const assemble = async (plans: any[], project = 'project') => {
        await exports.api.resolveMultipartSubPartNames(plans);
        const groups = exports.api.groupPlans(plans);
        const seeded = await exports.api.placeSeeds(groups, project);
        const templates = exports.api.collectComponentTemplates(records, groups, project, seeded);
        const result = exports.api.cloneComponentsIntoSource(source.serializeDocumentSource(records), records, groups, templates);
        records = source.parseDocumentSource(result.source);
        normalizeMultipartSourceDesignators(records, plans.map(p => ({ designator: p.input.designator,
            primitiveId: p.primitiveId, partUuid: p.input.part_uuid, subPartName: p.input.sub_part_name })));
        return plans.map(p => ({
            component: records.find(r => r.outer.id === p.primitiveId)!.inner!,
            attrs: Object.fromEntries(records.filter(r => r.inner?.parentId === p.primitiveId)
                .map(r => [r.inner!.key, r.inner!.value])),
        }));
    };
    return { plan, assemble, api: exports.api, get records() { return records; }, get imports() { return imports; } };
}

test('two LM358 packages use one import, distinct sections and separate designators', async () => {
    const f = fixture();
    const units = await f.assemble(['U1.2', 'U2.1', 'U1.1', 'U2.2'].map(ref => f.plan(ref)));
    assert.equal(f.imports, 1, 'the native API imports on every create call');
    assert.deepEqual(units.map(u => u.component.partId), ['LM358DR.2', 'LM358DR.1', 'LM358DR.1', 'LM358DR.2']);
    assert.deepEqual(units.map(u => u.attrs.Designator), ['U1', 'U2', 'U1', 'U2']);
    for (const key of ['Device', 'Symbol', 'Footprint']) assert.equal(new Set(units.map(u => u.attrs[key])).size, 1);
    assert.equal(units[0].attrs['Unique ID'], 'uid-1');
    assert(units.slice(1).every(u => u.attrs['Unique ID'] === ''), 'native editor assigns new instance identities');
});

test('later sections reuse a cached import without changing its original section', async () => {
    const f = fixture();
    await f.assemble([f.plan('U1.1')]);
    const [b] = await f.assemble([f.plan('U2.2')]);
    const [a] = await f.assemble([f.plan('U3.1')]);
    assert.equal(f.imports, 1);
    assert.equal(b.component.partId, 'LM358DR.2');
    assert.equal(a.component.partId, 'LM358DR.1');
    assert.equal(a.attrs.Device, b.attrs.Device);
});

test('different libraries and projects do not share imported identities', async () => {
    const f = fixture();
    const [a, b] = await f.assemble([f.plan('U1.1'), f.plan('U2.2', 'other-library')]);
    const [c] = await f.assemble([f.plan('U3.1')], 'other-project');
    assert.equal(f.imports, 3);
    assert.equal(new Set([a, b, c].map(u => u.attrs.Device)).size, 3);
});

test('invalid explicit section is rejected before importing or cloning', async () => {
    const f = fixture();
    await assert.rejects(f.assemble([f.plan('U1.3')]), /Cannot resolve multi-part/);
    assert.equal(f.imports, 0);
});

test('existing section on the page supplies another section without reimport', async () => {
    const f = fixture();
    const plans = [f.plan('U1.1')];
    const groups = f.api.groupPlans(plans);
    await f.api.placeSeeds(groups, 'project'); // Simulate an existing page, before populating the cache.
    const b = f.plan('U2.2');
    assert.equal(await f.api.cacheTemplatesFromCurrentPage(f.api.groupPlans([b]), 'project', f.records), 1);
    const [unit] = await f.assemble([b]);
    assert.equal(f.imports, 1);
    assert.equal(unit.component.partId, 'LM358DR.2');
    assert.equal(unit.attrs.Device, 'device-1');
});
