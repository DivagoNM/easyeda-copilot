import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assemblyPcbBlock, readPcbDeclaration, storePcbBlockOnPrimitive } from '../src/eda/pcb-block-properties';
import { getSchematicGroups, mergeSchematicGroups, type SchematicGroupsSnapshot as Snapshot } from '../src/eda/schematic-groups';

const primitive = (properties: Record<string, unknown> | null, fail: { get?: boolean; set?: boolean } = {}) => {
    let current = properties;
    return {
        getState_OtherProperty: () => { if (fail.get) throw new Error('get failed'); return current; },
        setState_OtherProperty: (next: Record<string, string | number | boolean>) => { if (fail.set) throw new Error('set failed'); current = next; },
        current: () => current,
    };
};

test('assembly writes PCB Block per instance, keeps other properties and skips net symbols', () => {
    const p = primitive({ Value: '10k', 'PCB Block': 'seed_block' });
    assert.equal(storePcbBlockOnPrimitive(p, assemblyPcbBlock({ designator: 'R1', block_name: 'buck_feedback' })), true);
    assert.deepEqual(p.current(), { Value: '10k', 'PCB Block': 'buck_feedback' });
    assert.equal(assemblyPcbBlock({ designator: 'GND|1', block_name: 'power' }), undefined);
    assert.equal(assemblyPcbBlock({ designator: 'U1', block_name: '__v_root__' }), undefined);
    assert.equal(assemblyPcbBlock({ designator: 'U1', block_name: '  ' }), undefined);
});

test('a failed property read or write never throws and never replaces existing properties', () => {
    assert.equal(storePcbBlockOnPrimitive(primitive({ Value: '1' }, { get: true }), 'mcu'), false);
    const unwritable = primitive({ Value: '1' }, { set: true });
    assert.equal(storePcbBlockOnPrimitive(unwritable, 'mcu'), false);
    assert.deepEqual(unwritable.current(), { Value: '1' });
    assert.equal(storePcbBlockOnPrimitive({}, 'mcu'), false);
    assert.equal(storePcbBlockOnPrimitive(primitive(null), undefined), false);
});

test('only non-empty string properties declare a block', () => {
    assert.deepEqual(readPcbDeclaration({ 'PCB Block': ' buck ', 'PCB Module': 'power', 'PCB Attach': '', 'PCB Role': 7 }),
        { block: 'buck', module: 'power' });
    for (const properties of [null, undefined, {}, { 'PCB Block': 3 }, { 'PCB Module': 'power' }]) {
        assert.equal(readPcbDeclaration(properties as Record<string, unknown> | null | undefined), undefined);
    }
});

const pin = (number: string, x: number, y: number) => ({ number, x, y, net: null });
const part = (designator: string, x: number, pcb?: Snapshot['components'][number]['pcb'], subPartName?: string) =>
    ({ designator, x, y: 0, pins: [pin('1', x, 0)], ...(subPartName ? { subPartName } : {}), ...(pcb ? { pcb } : {}) });

test('declared blocks and modules come from properties, with conflicts reported and omitted', async () => {
    const groups = await getSchematicGroups({ wires: [], components: [
        part('U1', 0, { block: 'buck_core', module: 'buck', role: 'power' }),
        part('L1', 1000, { block: 'buck_core', module: 'buck' }),
        part('C1', 2000, { block: 'buck_input', module: 'buck', attach: 'buck_core' }),
        part('C2', 3000, { block: 'buck_input', module: 'power', attach: 'buck_core' }),
        part('U2', 4000, { block: 'opamp', role: 'analog' }, 'U2.1'),
        part('U2', 5000, { block: 'opamp', role: 'analog' }, 'U2.2'),
        part('R9', 6000),
    ] });
    assert.deepEqual(groups.declared_blocks, [
        { name: 'buck_core', refs: 'L1 U1', module: 'buck', role: 'power' },
        { name: 'buck_input', refs: 'C1 C2', attach_to: 'buck_core' },
        { name: 'opamp', refs: 'U2.1 U2.2', role: 'analog' },
    ]);
    assert.deepEqual(groups.declared_modules, [{ name: 'buck', blocks: ['buck_core'] }]);
    assert.deepEqual(groups.declaration_errors, ['PCB block buck_input: conflicting PCB Module values (buck, power); omitted.']);
    assert.equal(groups.errors, undefined, 'declaration problems do not make heuristic groups incomplete');
});

test('pages without declarations keep the previous result shape', async () => {
    assert.deepEqual(await getSchematicGroups({ components: [part('R1', 0)], wires: [] }), { maybe_blocks: [], wires: [] });
    assert.deepEqual(mergeSchematicGroups([{ maybe_blocks: ['C1 U1'], wires: [] }]), { maybe_blocks: ['C1 U1'], wires: [] });
});

test('a block may span pages; cross-page conflicts and malformed page data are reported, not thrown', () => {
    const merged = mergeSchematicGroups([
        { maybe_blocks: [], wires: [], declared_blocks: [{ name: 'mcu', refs: 'U1', module: 'core' }] },
        { maybe_blocks: [], wires: [], declared_blocks: [{ name: 'mcu', refs: 'C1 C2', module: 'core' }, { name: 'usb', refs: 'J1', role: 'connector' }],
            declaration_errors: ['page 2 warning'] },
        { maybe_blocks: [], wires: [], declared_blocks: [{ name: 'usb', refs: 'R1', role: 'power' }] },
    ]);
    assert.deepEqual(merged.declared_blocks, [{ name: 'mcu', refs: 'C1 C2 U1', module: 'core' }, { name: 'usb', refs: 'J1 R1' }]);
    assert.deepEqual(merged.declared_modules, [{ name: 'core', blocks: ['mcu'] }]);
    assert.deepEqual(merged.declaration_errors, ['page 2 warning', 'PCB block usb: conflicting PCB Role values (connector, power); omitted.']);
    const broken = mergeSchematicGroups([{ maybe_blocks: ['C1 U1'], wires: [], declared_blocks: [{ name: 'x' } as never] }]);
    assert.deepEqual(broken.maybe_blocks, ['C1 U1']);
    assert.equal(broken.declared_blocks, undefined);
    assert.match(broken.declaration_errors![0], /could not be merged/);
});

test('a package whose sections are declared in different blocks is reported and left out of both', async () => {
    const page = await getSchematicGroups({ wires: [], components: [
        part('U2', 0, { block: 'preamp' }, 'U2.1'), part('U2', 1000, { block: 'filter' }, 'U2.2'),
        part('R1', 2000, { block: 'preamp' }), part('R2', 3000, { block: 'filter' }),
    ] });
    assert.deepEqual(page.declared_blocks, [{ name: 'filter', refs: 'R2' }, { name: 'preamp', refs: 'R1' }]);
    assert.deepEqual(page.declaration_errors, ['U2: sections declared in several PCB blocks (filter, preamp); omitted from them.']);
    const merged = mergeSchematicGroups([
        { maybe_blocks: [], wires: [], declared_blocks: [{ name: 'preamp', refs: 'U3.1 R5' }] },
        { maybe_blocks: [], wires: [], declared_blocks: [{ name: 'filter', refs: 'U3.2' }] },
    ]);
    assert.deepEqual(merged.declared_blocks, [{ name: 'preamp', refs: 'R5' }]);
    assert.deepEqual(merged.declaration_errors, ['U3: sections declared in several PCB blocks (filter, preamp); omitted from them.']);
});
