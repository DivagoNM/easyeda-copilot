/** Component properties that declare the PCB block hierarchy in the schematic.
 * Components without `PCB Block` keep the heuristic grouping. */
export const PCB_BLOCK_PROPERTIES = {
    block: 'PCB Block',
    module: 'PCB Module',
    attach: 'PCB Attach',
    role: 'PCB Role',
} as const;

/** Declarations belong to one instance: copies of a template must not inherit them. */
export const PCB_BLOCK_PROPERTY_KEYS: ReadonlySet<string> = new Set(Object.values(PCB_BLOCK_PROPERTIES));

export interface PcbDeclaration { block: string; module?: string; attach?: string; role?: string }

type PropertyPrimitive = {
    getState_OtherProperty?(): Record<string, unknown> | null | undefined;
    setState_OtherProperty?(otherProperty: Record<string, string | number | boolean>): unknown;
};

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** User-edited values: anything but a non-empty string is treated as absent. */
export function readPcbDeclaration(properties: Record<string, unknown> | null | undefined): PcbDeclaration | undefined {
    const block = text(properties?.[PCB_BLOCK_PROPERTIES.block]);
    if (!block) return undefined;
    const declaration: PcbDeclaration = { block };
    for (const key of ['module', 'attach', 'role'] as const) {
        const value = text(properties?.[PCB_BLOCK_PROPERTIES[key]]);
        if (value) declaration[key] = value;
    }
    return declaration;
}

/** Block written during assembly. Net symbols and internal assembly names get none. */
export function assemblyPcbBlock(component: { designator: string; block_name?: string }): string | undefined {
    const name = text(component.block_name);
    return name && !name.startsWith('__') && !component.designator.includes('|') ? name : undefined;
}

/** Never throws: a failed write must not fail assembly or skip the component.
 * Other properties are kept; when they cannot be read, nothing is written. */
export function storePcbBlockOnPrimitive(primitive: PropertyPrimitive, block: string | undefined): boolean {
    if (!block) return false;
    try {
        if (!primitive.setState_OtherProperty || !primitive.getState_OtherProperty) return false;
        const properties = primitive.getState_OtherProperty() ?? {};
        if (properties[PCB_BLOCK_PROPERTIES.block] === block) return true;
        primitive.setState_OtherProperty({ ...properties, [PCB_BLOCK_PROPERTIES.block]: block } as Record<string, string | number | boolean>);
        return true;
    } catch { return false; }
}
