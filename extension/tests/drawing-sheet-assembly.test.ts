import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { DRAWING_SHEETS, selectDrawingSheet } from '../src/eda/schematic-page-geometry';

const sourceFile = resolve(__dirname, '../src/eda/assemble-source.ts');
const sourceCode = ts.transpileModule(
    readFileSync(sourceFile, 'utf8') + '\nexport const assemblyOffsetForTest = getAssemblyOffset;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: sourceFile },
).outputText;

function fixture() {
    const controller = new AbortController();
    const events: string[] = [];
    const warnings: string[] = [];
    let size = { width: DRAWING_SHEETS[0].width, height: DRAWING_SHEETS[0].height };
    let symbol: string = 'A4';
    const eda = {
        sys_Log: { add(message: string) { warnings.push(message); } },
        dmt_Schematic: { getCurrentSchematicPageInfo: async () => ({ titleBlockData: {
            Symbol: { value: `Drawing-Symbol_${symbol}` },
            'Title Block Position': { value: '3' },
        } }) },
        lib_Device: { get: async () => ({ uuid: 'drawing' }) },
        sch_PrimitiveComponent: { create: async (): Promise<unknown> => { events.push('create'); throw new Error('drawing unavailable'); } },
    };
    const exports: Record<string, any> = {};
    runInNewContext(sourceCode, {
        exports, eda, structuredClone, setTimeout: (callback: () => void) => setTimeout(callback, 0),
        ESYS_LogType: {},
        require(name: string) {
            if (name === './utils') return { getPageSize: async () => size, yieldToEventLoop: async () => {} };
            if (name === './schematic-page-geometry') return { DRAWING_SHEETS, selectDrawingSheet, DRAWING_LIBRARY_UUID: 'drawing-library' };
            if (name === './free-place-searcher') return { searchFreePlaceV2: async (target: unknown) => target };
            return {};
        },
    });
    const circuit = { blocks_rect: [{ name: '__v_root__', width: 1030, height: 685 }], assembly_options: { auto_resize_page: true } };
    return {
        controller, eda, events, warnings, circuit,
        getOffset: () => exports.assemblyOffsetForTest(circuit, controller.signal),
        changeSheet: (width: number, height: number, name: string) => { size = { width, height }; symbol = name; },
    };
}

test('assembly replaces a large drawing sheet with the smallest fitting format', async () => {
    const f = fixture();
    const a0 = DRAWING_SHEETS[4];
    const a3 = DRAWING_SHEETS[1];
    f.changeSheet(a0.width, a0.height, a0.name);
    f.eda.sch_PrimitiveComponent.create = async () => {
        f.events.push('create');
        f.changeSheet(a3.width, a3.height, a3.name);
    };
    const result = await f.getOffset();
    const selected = selectDrawingSheet(a0, 1030, 685)!;
    assert.deepEqual(f.events, ['create']);
    assert.equal(result.x, selected.placement.x);
    assert.equal(result.y, selected.placement.y + 685);
    assert.ok(f.warnings.some(message => message.includes('Resized schematic page to A3')));
});

test('disabled automatic resizing keeps a large sheet', async () => {
    const f = fixture();
    const a0 = DRAWING_SHEETS[4];
    f.changeSheet(a0.width, a0.height, a0.name);
    f.circuit.assembly_options.auto_resize_page = false;
    const result = await f.getOffset();
    assert.deepEqual(f.events, []);
    assert.equal(result.x, (a0.width - 1030) / 2);
    assert.equal(result.y, (a0.height - 685) / 2 + 685);
});

for (const [actualIndex, label, width, height, expectedIndex] of [
    [3, 'A0', 3400, 2100, 4], // AcquisitionMemory: A0 label with A1 dimensions.
    [1, 'A1', 2000, 1200, 2], // ControlDisplay: A1 label with A3 dimensions.
    [1, 'A1', 1030, 685, 1], // Correct the label even when the dimensions already fit.
] as const) {
    test(`inconsistent ${label} drawing at ${DRAWING_SHEETS[actualIndex].name} dimensions selects ${DRAWING_SHEETS[expectedIndex].name} for ${width}x${height}`, async () => {
        const f = fixture();
        const actual = DRAWING_SHEETS[actualIndex];
        const expected = DRAWING_SHEETS[expectedIndex];
        f.changeSheet(actual.width, actual.height, label);
        Object.assign(f.circuit.blocks_rect[0], { width, height });
        f.eda.lib_Device.get = async (uuid?: string) => {
            assert.equal(uuid, expected.deviceUuid);
            return { uuid: 'drawing' };
        };
        f.eda.sch_PrimitiveComponent.create = async () => {
            f.events.push('create');
            f.changeSheet(expected.width, expected.height, expected.name);
        };
        const result = await f.getOffset();
        const selected = selectDrawingSheet(actual, width, height)!;
        assert.deepEqual(f.events, ['create']);
        assert.equal(result.x, selected.placement.x);
        assert.equal(result.y, selected.placement.y + height);
    });
}

test('custom drawing names or dimensions do not trigger standard drawing replacement', async () => {
    for (const [width, height, name] of [[1170, 825, 'custom'], [1400, 900, 'A4']] as const) {
        const f = fixture();
        f.changeSheet(width, height, name);
        await f.getOffset();
        assert.deepEqual(f.events, []);
        assert.ok(f.warnings.some(message => message.includes('Custom or inconsistent drawing symbol')));
    }
});

test('completed drawing creation failure continues using the observed sheet dimensions', async () => {
    const f = fixture();
    f.eda.sch_PrimitiveComponent.create = async () => {
        f.events.push('create');
        f.changeSheet(1400, 900, 'custom');
        throw new Error('drawing unavailable');
    };
    const result = await f.getOffset();
    assert.equal(result.x, (1400 - 1030) / 2);
    assert.equal(result.y, (900 - 685) / 2 + 685);
    assert.deepEqual(f.events, ['create']);
    assert.ok(f.warnings.some(warning => warning.includes('keeping the observed page size')));
});

test('cancellation during library lookup prevents drawing creation', async () => {
    const f = fixture();
    f.eda.lib_Device.get = async () => { f.controller.abort(); return { uuid: 'drawing' }; };
    await assert.rejects(f.getOffset());
    assert.deepEqual(f.events, []);
});

test('cancellation during drawing observation prevents further reads and placement', async () => {
    const f = fixture();
    f.eda.sch_PrimitiveComponent.create = async () => { f.events.push('create'); f.controller.abort(); };
    await assert.rejects(f.getOffset());
    assert.deepEqual(f.events, ['create']);
});
