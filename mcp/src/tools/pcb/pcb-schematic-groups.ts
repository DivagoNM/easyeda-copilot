import type { PcbSchematicGroups } from 'eda-copilot-backend/pcb';
import type { ExplainCircuit } from '@copilot/shared/types/circuit';
import type { SchematicGroups } from '@copilot/shared/types/schematic-groups';

/** Blocks declared with `PCB Block` component properties, by physical designator. */
export type PcbBlockDeclarations = {
    blocks: { name: string; components: string[]; module?: string; attachTo?: string; role?: string }[];
    incomplete?: boolean;
};

/** Translate EasyEDA's compact references into the backend's editor-independent contract. */
export function toPcbSchematicGroups(source: SchematicGroups, circuit: ExplainCircuit): PcbSchematicGroups & { declarations?: PcbBlockDeclarations } {
    const designators = new Set(circuit.components.map(c => c.designator));
    let incomplete = !!source.errors?.length;
    const groups = source.maybe_blocks.flatMap(block => {
        const references = block.trim().split(/\s+/).filter(Boolean);
        const components = references.map(ref => designators.has(ref) ? ref : ref.replace(/\.\d+$/, ''));
        if (components.some(name => !designators.has(name))) { incomplete = true; return []; }
        return components.length ? [{ components: [...new Set(components)].sort() }] : [];
    });
    // Wire references name actual pins, whereas maybe_blocks references name symbol sections.
    const pinRefs = new Map<string, Array<{ designator: string; pin_number: string | number }>>();
    for (const component of circuit.components) for (const pin of component.pins) {
        const key = component.designator + '.' + String(pin.pin_number);
        const refs = pinRefs.get(key) ?? [];
        refs.push({ designator: component.designator, pin_number: pin.pin_number }); pinRefs.set(key, refs);
    }
    const wireIslands = (source.wires ?? []).flatMap(wire => {
        if (wire.net !== null && typeof wire.net !== 'string') { incomplete = true; return []; }
        const refs = [...new Set(wire.pins.trim().split(/\s+/).filter(Boolean))].sort();
        if (refs.some(ref => pinRefs.get(ref)?.length !== 1)) { incomplete = true; return []; }
        return refs.length >= 2 ? [{ net: wire.net, pins: refs.map(ref => pinRefs.get(ref)![0]) }] : [];
    });
    const declarations = toPcbBlockDeclarations(source, designators);
    return { groups, ...(wireIslands.length ? { wireIslands } : {}), ...(incomplete ? { incomplete: true } : {}),
        ...(declarations ? { declarations } : {}) };
}

/** Declarations stay separate from heuristic groups and never mark them incomplete.
 * Unknown references are dropped and reported through `incomplete`. */
function toPcbBlockDeclarations(source: SchematicGroups, designators: Set<string>): PcbBlockDeclarations | undefined {
    try {
        if (!source.declared_blocks?.length) return undefined;
        let incomplete = !!source.declaration_errors?.length;
        const blocks = source.declared_blocks.flatMap(block => {
            if (typeof block?.name !== 'string' || !block.name || typeof block.refs !== 'string') { incomplete = true; return []; }
            const components = new Set<string>();
            for (const ref of block.refs.trim().split(/\s+/).filter(Boolean)) {
                const name = designators.has(ref) ? ref : ref.replace(/\.[A-Za-z0-9]+$/, '');
                if (designators.has(name)) components.add(name); else incomplete = true;
            }
            if (!components.size) return [];
            const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
            const module = text(block.module), attachTo = text(block.attach_to), role = text(block.role);
            return [{ name: block.name, components: [...components].sort(),
                ...(module ? { module } : {}), ...(attachTo ? { attachTo } : {}), ...(role ? { role } : {}) }];
        });
        // A package in several blocks (sections declared apart) fits none of them.
        const owners = new Map<string, number>();
        for (const block of blocks) for (const name of block.components) owners.set(name, (owners.get(name) ?? 0) + 1);
        const placeable = blocks.flatMap(block => {
            const components = block.components.filter(name => owners.get(name) === 1);
            if (components.length !== block.components.length) incomplete = true;
            return components.length ? [{ ...block, components }] : [];
        });
        return placeable.length || incomplete ? { blocks: placeable, ...(incomplete ? { incomplete: true } : {}) } : undefined;
    } catch {
        // Malformed editor metadata must not break validation; keep the heuristic context.
        return { blocks: [], incomplete: true };
    }
}
