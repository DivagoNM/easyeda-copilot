/** Compact, read-only context for one schematic page or concatenated page-local results. */
export interface SchematicGroups {
    maybe_blocks: string[];
    wires: {
        net: string | null;
        pins: string;
    }[];
    /** At most 10 short diagnostics; omitted on a complete, successful read. */
    errors?: string[];
    /** Blocks declared with the `PCB Block` component property; omitted when none. */
    declared_blocks?: {
        name: string;
        /** Space-separated references, as in maybe_blocks. */
        refs: string;
        module?: string;
        attach_to?: string;
        role?: string;
    }[];
    /** Modules of the declared blocks (`PCB Module`); omitted when none. */
    declared_modules?: { name: string; blocks: string[] }[];
    /** Problems with the declarations only; they do not make maybe_blocks or wires incomplete. */
    declaration_errors?: string[];
}
