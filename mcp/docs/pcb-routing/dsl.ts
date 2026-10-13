/**
 * EasyEDA PCB routing DSL. Declare all requirements, then use one terminal command.
 * One object per declaration; one terminal command per file. Units are named explicitly.
 * Omitted rules inherit board defaults. Usage and host limitations: instructions.md.
 */

// Layers and selectors
type InnerLayerNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30;

type PhysicalLayer = "TOP" | "BOTTOM" | `INNER_${InnerLayerNumber}`;

type LayerSelector = PhysicalLayer | "OUTER" | "ALL" | readonly PhysicalLayer[];

interface PadRef { readonly __dsl: "pad"; }

interface ComponentRef { readonly __dsl: "component"; }

interface NetRef { readonly __dsl: "net"; }

interface RegionRef { readonly __dsl: "region"; }

type NetSelection = readonly string[];

type CopperTarget = PadRef | NetRef;

type PointMm = readonly [xMm: number, yMm: number];

type RegionSource = RegionRef | ComponentRef;

/** Components use under(auto); arrays preserve separate regions and holes. */
type RegionSelection = RegionSource | readonly RegionSource[];

/** Select a logical pad by component designator and pad number. Does not create or move copper. */
declare function pad(component: string, number: string | number): PadRef;

/** Select a component by designator. Use under(...) when an explicit component outline is needed. */
declare function component(designator: string): ComponentRef;

/** Select regions occupied by the named components (the main selector). Separate components remain separate regions. */
declare function components(...designators: string[]): RegionRef;

/** Select all pads of a named electrical net for copper connections. Does not declare routing rules. */
declare function net(name: string): NetRef;

/** Select the board area, including its existing cutouts. Does not select nets or layers. */
declare function board(): RegionRef;

/** Define a reusable region in millimetres. Outline is the outer boundary; holes are excluded areas. */
declare function region(id: string, options: {
  outline: readonly PointMm[];
  holes?: readonly (readonly PointMm[])[];
}): RegionRef;

/**
 * Select the area under a component. Default outline auto tries body, courtyard, bbox, then pads; margin
 * defaults to 0 mm. An explicit outline must exist.
 */
declare function under(target: ComponentRef, options?: {
  outline?: "auto" | "body" | "courtyard" | "bbox" | "pads";
  /** Default: 0 mm. */
  marginMm?: number;
}): RegionRef;

/** Expand a region by marginMm; a negative value contracts it. Preserves holes where geometry permits. */
declare function expand(region: RegionSelection, marginMm: number): RegionRef;

/** Combine areas into a region without bridging disconnected islands. */
declare function union(...regions: RegionSelection[]): RegionRef;

/** Select only the area shared by every supplied region. */
declare function intersect(...regions: RegionSelection[]): RegionRef;

/** Remove the supplied hole regions from the first region. */
declare function subtract(region: RegionSelection, ...holes: RegionSelection[]): RegionRef;

// Rules and stackup

/** Nominal dimensions and hard minima, as in main. */
interface ViaOptions {
  diameterMm?: number;
  drillMm?: number;
  minDiameterMm?: number;
  minDrillMm?: number;
}

interface ViaGeometry {
  diameterMm: number;
  drillMm: number;
}

/**
 * Post-processing. Counts apply per layer transition and include existing connected vias; minViasPerTransition
 * defaults to 1.
 */
interface LayerTransitionOptions {
  via?: ViaGeometry;
  minViasPerTransition?: number;
  /** Maximum vias per layer transition, including existing connected vias. */
  maxCount?: number;
  arrangement?: "auto" | "row" | "array";
  pitchMm?: number;
  viaInPad?: boolean;
}

/** Flat physical rules from main. Omitted values inherit effective board/net-class rules. */
interface RuleOptions {
  /** Nominal routing width; narrowing must still satisfy minTrackWidthMm. */
  trackWidthMm?: number;
  /** Hard minimum track width. */
  minTrackWidthMm?: number;
  /** Upper bound for automatic width selection. */
  maxTrackWidthMm?: number;
  /** Via dimensions and their hard manufacturing minima. */
  via?: ViaOptions;
  clearanceMm?: number;
  edgeClearanceMm?: number;
  holeToHoleClearanceMm?: number;
  /** Required route layers. A common mask is enforced; differing masks for open nets are rejected before WASM. */
  allowedLayers?: LayerSelector;
}

interface RouteOptions extends RuleOptions {
  layerTransitions?: LayerTransitionOptions;
  impedance?: ImpedanceOptions;
}

/**
 * Set common physical routing rules for this program. Omitted fields inherit board rules; runAll/applyDrcRules
 * request host persistence.
 */
declare function drc(options: RuleOptions): void;

/** Declare a net class with its rules and member nets. Fields omitted here inherit the effective common rules. */
declare function netClass(options: RuleOptions & {
  name: string;
  nets: NetSelection;
}): void;

/** Add or move selected nets into an existing class without replacing its other members. */
declare function assignNetsToNetClass(options: { name: string; nets: readonly string[] }): void;

/** Remove selected nets from the named class. Does not delete the nets or their copper. */
declare function removeNetsFromNetClass(options: { name: string; nets: readonly string[] }): void;

/** Remove selected nets from whichever net class currently owns them. */
declare function unassignNetClass(options: { nets: readonly string[] }): void;

/** Delete the named net-class relation; does not delete its nets or copper. */
declare function deleteNetClass(options: { name: string }): void;

/** disableRouting affects tracks, not pours or through-via spans. */
interface CopperLayer {
  kind: "copper";
  name: PhysicalLayer;
  thicknessOz?: number;
  thicknessMm?: number;
  /** main: disables new tracks, not pours or through-via spans. Default false. */
  disableRouting?: boolean;
}

interface DielectricLayer {
  kind: "dielectric";
  name?: string;
  thicknessMm?: number;
  relativePermittivity?: number;
  lossTangent?: number;
  material?: string;
}

interface MaskLayer {
  thicknessMm?: number;
  relativePermittivity?: number;
}

/**
 * Declare the physical stack and global layer restrictions. Electrical calculations require actual
 * material/thickness data; runAll/applyStackup request host persistence.
 */
declare function stack(options: {
  boardThicknessMm?: number;
  fallbackCopperThicknessOz?: number;
  viaPlatingThicknessUm?: number;
  maxTrackWidthMm?: number;
  layers?: readonly (CopperLayer | DielectricLayer)[];
  solderMask?: {
    top?: MaskLayer;
    bottom?: MaskLayer;
  };
}): void;

// Nets and impedance
/**
 * Set routing requirements for one signal net. Omitted fields inherit its class/board rules. Returns a net
 * selector for reuse; no routing starts here.
 */
declare function signalNet(options: RouteOptions & {
  net: string;
  netClass?: string;
}): NetRef;

/** Reference net; omitted layers select the nearest suitable reference copper. */
type ReferenceSelection = {
  net: string;
  layers?: LayerSelector;
};

/** Post-processing; defaults: maxDistanceMm = 1, minCount = 1. */
interface ReturnViaOptions {
  reference?: ReferenceSelection;
  maxDistanceMm?: number;
  via?: ViaGeometry;
  minCount?: number;
}

/** Physical stack and actual reference copper are required for impedance checks. */
interface ImpedanceOptions {
  targetOhm: number;
  /** Default: 10%. */
  tolerancePercent?: number;
  /** Omitted/auto selects the nearest unambiguous reference copper. */
  referenceNet?: string | "auto";
  /** Additional reference vias; reference-copper continuity is checked separately. */
  returnVias?: false | ReturnViaOptions;
}

// Power routing
/** Uniform requirements for the whole net; no source/trunk/consumer tree. */
interface PowerNetOptions extends RouteOptions {
  netClass?: string;
  /** Current requirement for the net, in amperes; no per-consumer aggregation. */
  maxCurrentA?: number;
  /** IPC-2221 chart temperature rise; default 16 C. */
  maxTempRiseC?: number;
}

/**
 * Set uniform requirements for one power net, including current/temperature limits and layer-transition
 * reinforcement. No source/load tree or per-pad width profiles. Returns a net selector.
 */
declare function powerNet(options: PowerNetOptions & { net: string }): NetRef;

// Differential pairs and matching
interface DiffPairOptions extends RouteOptions {
  positive: string;
  negative: string;
  /** Enabled by default as post-processing; false disables it. */
  returnVias?: false | ReturnViaOptions;
  /** Edge-to-edge spacing on coupled sections. */
  gapMm?: number;
  /** Maximum positive/negative path-length difference. */
  maxSkewMm?: number;
  maxUncoupledLengthMm?: number;
}

/**
 * Declare a positive/negative net pair, gap and skew limits. Omitted geometry inherits effective rules. Routing
 * starts only at the terminal command.
 */
declare function diffPair(options: DiffPairOptions & { id: string }): void;

/** Delete the named differential-pair relation; retains the nets and existing copper. */
declare function deleteDiffPair(options: { id: string }): void;

/** Select a terminal path within a branched net; other branches remain ordinary routing. */
interface MatchEndpoints {
  net: string;
  from: PadRef;
  to: PadRef;
}

/** Choose length or delay matching; endpoints select a path inside a branched net. */
type MatchedGroupOptions = {
  id: string;
  nets: NetSelection;
  endpoints?: readonly MatchEndpoints[];
} & ({
  /** Maximum length spread; omitted inherits an existing effective group rule. */
  toleranceMm?: number;
  /** Optional target length for every selected path. */
  targetMm?: number;
  delay?: never;
} | {
  toleranceMm?: never;
  targetMm?: never;
  /** Delay needs a supported stack/reference model; unknown delay is not a pass. */
  delay: { tolerancePs: number; targetPs?: number; referenceNet: string };
});

/**
 * Declare matching before routing; local tuning follows the global route. The simple main form is
 * {id,nets,toleranceMm}. Select endpoints for branched nets. Length and delay constraints cannot be mixed.
 */
declare function matchedGroup(options: MatchedGroupOptions): void;

/**
 * Add selected nets to an existing group without replacing its other members. Use moveNetsToMatchedGroup for
 * nets owned by another group.
 */
declare function addNetsToMatchedGroup(options: { id: string; nets: readonly string[] }): void;
/** Remove selected nets from the named group. As in main, groups with fewer than two net members are removed. */
declare function removeNetsFromMatchedGroup(options: { id: string; nets: readonly string[] }): void;
/** Move selected nets from their current matched groups into the named group. */
declare function moveNetsToMatchedGroup(options: { id: string; nets: readonly string[] }): void;
/** Delete the named matching relation; does not remove routed tracks. */
declare function deleteMatchedGroup(options: { id: string }): void;

// Planes and compact copper

/** Default pad connection is solid; thermals are explicit. */
interface ZoneOptions {
  clearanceMm?: number;
  minThicknessMm?: number;
  fill?: {
    style?: "solid" | "grid" | "grid45";
  };
  padConnection?: {
    mode?: "solid" | "thermal" | "none";
    thermalGapMm?: number;
    spokeWidthMm?: number;
  };
  /** Preserve isolated copper islands; false removes all unanchored islands. */
  preserveIslands?: boolean;
}

interface StitchOptions {
  pitchMm: number;
  via?: ViaGeometry;
  viaInPad?: boolean;
  region?: RegionSelection;
}

/** Default targets: all pads of the plane net in scope. No duplicate connections.
 * Via-in-pad requires explicit permission. Settings never relax effective DRC.
 */
interface TapOptions {
  targets?: "all" | readonly PadRef[];
  trackWidthMm?: number;
  minTrackWidthMm?: number;
  maxLengthMm?: number;
  allowedLayers?: LayerSelector;
  viaInPad?: boolean;
  layerTransitions?: LayerTransitionOptions;
}

interface PlaneStitchOptions {
  gridMm?: number;
  maxPadViaDistanceMm?: number;
  maxVisibleViaDistanceMm?: number;
  /** Omitted dimensions inherit effective rules, as in main. */
  via?: "drc-min" | Pick<ViaOptions, "diameterMm" | "drillMm">;
  viaInPad?: boolean;
}

/** Per-domain settings inherit the common plane settings. */
interface PlaneDomain {
  net: string;
  region?: RegionSelection;
  connect?: readonly CopperTarget[];
  minNeckWidthMm?: number;
  zone?: ZoneOptions;
  taps?: false | TapOptions;
  stitching?: boolean | PlaneStitchOptions;
}

/** region defaults to board(); TAP enabled, optional stitching disabled.
 * Priority controls overlapping fills, not routing order. Defaults: GND=0, others=1.
 */
interface PlaneCommon {
  layers?: LayerSelector;
  region?: RegionSelection;
  priority?: number;
  zone?: ZoneOptions;
  taps?: false | TapOptions;
  stitching?: boolean | PlaneStitchOptions;
}

/** Auto allocates domains from targets within permitted regions; it never drops a net.
 * Explicit requires non-overlapping regions. Both modes verify actual filled copper.
 * taps:false disables generation, not explicit connect requirements or validation.
 */
type PlaneOptions = PlaneCommon & ({
  net: string;
  connect?: readonly CopperTarget[];
  minNeckWidthMm?: number;
  domains?: never;
  allocation?: never;
} | {
  net?: never;
  domains: readonly PlaneDomain[];
  allocation?: "auto";
} | {
  net?: never;
  domains: readonly (PlaneDomain & { region: RegionSelection })[];
  allocation: "explicit";
});

/**
 * Declare a filled plane for one net or multiple power domains. Region defaults to board(), layers to OUTER, TAP
 * enabled and optional stitching disabled. Domains default to auto allocation; explicit requires a region per
 * domain. Existing connections are reused.
 */
declare function plane(options: PlaneOptions): void;

/** Required transitions connect every target; optional stitching is additional.
 * Ownership is internal; no public polygon id. Default mode: compact.
 */
interface PolygonOptions {
  net: string;
  connect: readonly CopperTarget[];
  /** Default TOP, as in main. */
  layers?: LayerSelector;
  compact?: {
    maxPadFreeGapWidths?: number;
    minNeckWidthMm?: number;
  };
  within?: RegionSelection;
  zone?: ZoneOptions;
  layerTransitions?: LayerTransitionOptions;
  stitching?: StitchOptions;
}

/**
 * Build compact copper joining the selected pads of one net. Layers default to TOP. Required interlayer
 * connections are included; optional stitching adds coverage. Generated object IDs are internal.
 */
declare function polygon(options: PolygonOptions): void;

// Copper selection
type CopperKind = "tracks" | "vias" | "zones";

// Stitching
interface ViaStitchCommon {
  /** drc-min, or dimensions with omitted fields inherited from rules. */
  via?: "drc-min" | Pick<ViaOptions, "diameterMm" | "drillMm">;
  viaInPad?: boolean;
  /** Optional layer restriction; omission uses the effective copper-layer scope. */
  layers?: LayerSelector;
}

type ViaStitchOptions = ViaStitchCommon & ({
  mode: "grid";
  net: string;
  region: RegionSelection;
  pitchMm: number;
} | {
  mode: "along";
  net: string;
  routes: NetSelection;
  pitchMm?: number;
  offsetMm?: number;
  rows?: number;
  rowSpacingMm?: number;
  stagger?: boolean;
} | {
  mode: "around";
  net: string;
  target: RegionSelection;
  pitchMm?: number;
  offsetMm?: number;
  rows?: number;
  side?: "inside" | "outside";
} | {
  mode: "return";
  referenceNet: string | "auto";
  /** main: selected signal nets; omission uses the routing scope. */
  forNets?: readonly string[];
  maxDistanceMm?: number;
  minCount?: number;
});

/**
 * Request stitching vias: grid covers a region, along follows routes, around follows a region boundary, return
 * adds reference vias near signal transitions. Existing usable vias count; via-in-pad requires permission.
 */
declare function viaStitch(options: ViaStitchOptions & { id: string }): void;

// Execution

/** Limit the global routing job to the listed nets. Does not create a stage or change electrical net membership. */
declare function onlyNets(options: { nets: readonly string[] }): void;

/**
 * Exclude the listed nets from the global routing job; their existing copper still remains an obstacle. Cannot
 * overlap onlyNets.
 */
declare function ignoreNets(options: { nets: readonly string[] }): void;

/**
 * Explicitly request removal of editable copper. As in main, omitted nets means all and omitted items means
 * tracks/vias; fixed/locked copper is retained. Prefer an explicit nets list.
 */
declare function clearRouting(options?: {
  nets?: "all" | readonly string[];
  /** Alias from main. Prefer nets; conflicting selectors must be rejected. */
  only?: readonly string[];
  items?: readonly CopperKind[];
}): void;

/** Terminal: persist effective DRC rules without autorouting. Exactly one terminal command is allowed per file. */
declare function applyDrcRules(): void;

/**
 * Terminal: persist the declared physical stack without autorouting. Exactly one terminal command is allowed per
 * file.
 */
declare function applyStackup(): void;

/**
 * Terminal: create/refill declared copper and execute enabled TAP/stitching, without signal autorouting. Uses
 * the same requirements and validator as a full run.
 */
declare function runCopper(): void;

/**
 * Terminal: run the global router and enabled copper/tuning postprocessing using effective rules, without
 * requesting persistence of changed DRC rules.
 */
declare function runRouting(): void;

/**
 * Terminal: apply the declared stack/DRC rules and run global routing with enabled copper/tuning postprocessing
 * and final validation.
 */
declare function runAll(): void;
