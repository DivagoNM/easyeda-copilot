import assert from 'node:assert/strict';
import test from 'node:test';
import { toPcbSchematicGroups } from '../src/tools/pcb/pcb-schematic-groups.ts';

const component = (designator: string) => ({ designator, value: 'x', pins: [{ pin_number: '1', name: 'A', signal_name: 'A' }] });
const circuit = { components: ['U1', 'U2', 'C1', 'L1'].map(component) } as never;

test('declarations reach the backend by physical designator, separate from heuristic groups', () => {
    const result = toPcbSchematicGroups({ maybe_blocks: ['C1 U1'], wires: [], declared_blocks: [
        { name: 'buck_core', refs: 'L1 U1', module: 'buck', role: 'power' },
        { name: 'opamp', refs: 'U2.1 U2.2', attach_to: 'buck_core' },
    ] }, circuit);
    assert.deepEqual(result.groups, [{ components: ['C1', 'U1'] }]);
    assert.equal(result.incomplete, undefined);
    assert.deepEqual(result.declarations, { blocks: [
        { name: 'buck_core', components: ['L1', 'U1'], module: 'buck', role: 'power' },
        { name: 'opamp', components: ['U2'], attachTo: 'buck_core' },
    ] });
});

test('no declarations keep the previous contract', () => {
    assert.deepEqual(toPcbSchematicGroups({ maybe_blocks: [], wires: [] }, circuit), { groups: [] });
});

test('unknown references, declaration errors and malformed entries mark only the declarations incomplete', () => {
    const result = toPcbSchematicGroups({ maybe_blocks: [], wires: [], declaration_errors: ['conflict'], declared_blocks: [
        { name: 'mcu', refs: 'U1 U9' }, { name: '', refs: 'C1' }, { name: 'ghost', refs: 'X1' }, null as never,
    ] }, circuit);
    assert.equal(result.incomplete, undefined);
    assert.deepEqual(result.declarations, { blocks: [{ name: 'mcu', components: ['U1'] }], incomplete: true });
    const broken = toPcbSchematicGroups({ maybe_blocks: [], wires: [], declared_blocks: 'oops' as never }, circuit);
    assert.deepEqual(broken.declarations, { blocks: [], incomplete: true });
});

test('a physical package declared in two blocks is left out of both and marks the declarations incomplete', () => {
    const result = toPcbSchematicGroups({ maybe_blocks: [], wires: [], declared_blocks: [
        { name: 'preamp', refs: 'U2.1 U1' }, { name: 'filter', refs: 'U2.2 C1' }, { name: 'only', refs: 'U2.3' },
    ] }, circuit);
    assert.deepEqual(result.declarations, { blocks: [
        { name: 'preamp', components: ['U1'] }, { name: 'filter', components: ['C1'] },
    ], incomplete: true });
});
