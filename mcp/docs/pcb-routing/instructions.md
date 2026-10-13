# PCB layer count, rules, copper, and routing

Use `run_pcb_router_dsl` after opening the exact target EasyEDA PCB. Read the local [dsl.ts](dsl.ts) as the LLM syntax reference. The router package has a separate reference, intentionally maintained independently; use the path reported by the tool when diagnosing an unsupported method or version mismatch. Do not invent helpers. Dimensions in this DSL are millimeters; routing layers are `TOP`, `BOTTOM`, and `INNER_n`. `preview_pcb` also uses uppercase layer names such as `TOP` and `BOTTOM`; its special all-layer selector is lowercase `all`. Placement DSL layer names use lowercase `top`/`bottom`.

Each file is JavaScript statements with exactly one terminal call. Write it to an absolute path on the MCP host, then pass that path as `file`. Do not put TypeScript declarations, imports, shell commands, or router CLI flags in the file.

Use the DSL for the routing plan and scoped repairs. For a precise native edit or a missing feature, such as a copper keepout, follow the [native API edit workflow](../execution/instructions.md). Use it when DSL attempts cannot resolve a diagnosed problem or when the local edit is clearly simpler to express directly. Check the result with [routing verification](verification.md).

Before local geometric repairs, choose the execution path: use `execute_js` for a self-contained native edit; prefer the [local SDK](../execution/local-sdk.md#when-to-use-the-sdk) when Python/Node.js calculations, Shapely geometry or repeated read–calculate–apply cycles are involved. Keep board readback, local computation and scoped writes in one SDK script, then refill and verify the affected copper. Switch to this path when local calculations become necessary even if the routing task started with MCP calls. The SDK provides native API access; it does not replace the routing engine or automatically enforce routing constraints.

This workflow may start from an existing placement, but placement and routing are one coupled physical problem. Before full routing, verify that the placement offers plausible critical-signal, power, return, dense-package escape, via, and thermal paths under the intended stack. A routing-only request does not authorize moving components: when placement is the root cause, report the exact bottleneck or return to the placement workflow only when the requested scope allows it. Do not conceal a bad placement with repeated routing attempts.

## Plan globally, route in one job

Declare the complete board requirements in one DSL file: physical stack, DRC rules,
signal and power nets, differential pairs, matching groups, planes and required
stitching. End with `runAll()`. The router prepares copper, routes ordinary signals
with WASM, then performs local width/matching and plane connections. It can make
one additional routing call for unresolved TAP connections. Progress phases are
snapshots of this operation, not separate DSL jobs.

Keep GND in scope when requesting its TAP connections. A plane with TAP enabled
already excludes that net from ordinary track routing. Do not add `ignoreNets`
for the same net: it also excludes that net from TAP processing. `onlyNets` must
include plane nets whose TAP connections you want to complete.

For a focused repair, use `onlyNets({nets:[...]})`, retaining both legs of a pair,
every matching-group member, and required reference-plane nets. Existing copper
is preserved by default; clear only diagnosed blockers. Do not split a fresh
board into independent priority passes merely to reserve space.

While an operation is running, use `wait_operation`. Cancel and establish its
terminal state before starting another mutation on the same PCB. A partial
result can contain useful verified copper; inspect its report before retrying.

## Ground: pour first, route only where needed

Use a continuous, connected ground pour as the default GND conductor and reference. Use `plane({ net, layers, region: board() })` for a board-wide pour or `polygon(...)` for targeted copper. Do not pre-route ordinary GND connections with tracks merely because it is ground.

Identify the actual nets from connectivity, including `/GND`, `VSS`, `AGND`, or `PGND` when present. Names are not interchangeable. Preserve intentional separate grounds and their defined connection points.

1. **Plan ground with critical circuits.** Choose the ground layers and space needed for return paths from the outset. Provide a specific critical return segment immediately when its current, timing, noise or local-loop geometry requires it, including necessary local return vias. This exception applies to that segment, not every connection on its ground net. Reserve a passage with a track only for a diagnosed need, not as a standard preliminary GND stage.
2. **Route ordinary circuits with the plane declared.** TAP-enabled plane nets are excluded from ordinary routing automatically. Keep them in scope for later TAP connections.
3. **Generate and verify the ground fill.** Rebuild pours and inspect actual connectivity of required pads and islands, reference continuity and narrow necks. Successfully creating a polygon does not prove that the required connection exists through its filled copper.
4. **Repair remaining ground connections.** First try correcting the local pour or adding necessary vias to useful ground copper. Use tracks where the pour cannot provide the required connection. Preserve valid filled copper and critical returns; after repair, rebuild affected pours and verify the whole requested scope again.

For example, after confirming that `GND` is the actual ordinary ground net and BOTTOM is the chosen pour layer, the full routing program can include:

```js
plane({ net: "GND", layers: "BOTTOM", region: board() });
// Include the board's stack, DRC rules and signal/power routing intent.
runAll();
```

`ignoreNets({nets:["GND"]})` intentionally excludes GND from TAP processing too.
Use it only when ground connections are outside the requested repair scope.

Choose repair-track geometry from the actual current and return-path requirements and effective DRC. A connection that remains the only conductor needs appropriate current capacity; do not apply a blanket minimum width. Narrow tracks and vias can establish connectivity without providing an adequate reference plane. Electrically connected islands still do not form a continuous reference on a split layer. If a required return corridor is blocked, diagnose the obstructing copper or placement and correct it within the authorized scope.

## Choose the ground-pour layers

Choose layers from the actual stack, signal reference needs, routing density, keepouts and component guidance. Explain the choice briefly; routine layer selection within the requested routing task does not need another approval.

- On a two-layer board, one relatively continuous ground layer can be the main reference. Add a pour on the other layer when it improves connections, return paths or shielding and can be connected usefully.
- `TOP`, `BOTTOM`, or `OUTER` can each be appropriate. `OUTER` means both external layers; it is the runtime default, not a requirement. Write `layers` explicitly so the choice is intentional.
- On a board with four or more layers, choose the reference layers from the stack. Do not pour every layer automatically.
- Respect antenna/RF copper exclusions, isolation gaps, and intentional ground partitions. Extra fill is useful only when its electrical role and connectivity are sound.

Example final pour for a board whose ground plan selects BOTTOM:

```js
plane({ net: "GND", layers: "BOTTOM", region: board() });
runCopper();
```

Use `runCopper()` when only copper generation is needed. Only after checking the rebuilt fill and trying appropriate pour/via corrections, use `onlyNets(...)` with the actual ground net and `runAll()` if the remaining connections require tracks; retain valid copper and include any required plane declarations. One `plane(...)` declaration is one logical zone; `zones: 1` does not identify how many physical layers were filled.

`onlyNets(...)` and `ignoreNets(...)` select routing scope, not the scope of copper declarations or deletion. Usually defer final GND pours and broad stitching until the relevant routes stabilize; retain or create earlier reference copper when the board needs it. For a new impedance reference, follow the [reference-plane guidance](#copper-layers-and-physical-assumptions). If existing zones or vias obstruct a later repair, use scoped cleanup for the diagnosed blockers.

## Board-wide GND stitching

Use stitching where it connects useful GND copper on different layers or provides a required return connection. Do not add a board-wide grid solely because the net is named GND. A broad grid is usually best added during final ground completion; add required return vias whenever the routing strategy needs them.

Choose positions and pitch from ground-island connectivity, return-current transitions, RF requirements and clearances. Place required local return vias near the relevant transitions even when a broad grid exists. The `pitchMm: 3` below is an illustrative grid spacing, not a universal electrical rule; the same reasoning applies to `plane(...).stitching.gridMm`.

```js
viaStitch({
  id: "GND_GRID",
  mode: "grid",
  net: "GND",
  region: board(),
  pitchMm: 3,
  via: "drc-min",
});
```

## Describe electrical intent

Let the router derive geometry from the effective rules and declared physical assumptions:

- Use `powerNet({net:"VBUS", maxCurrentA:2})` instead of calculating track width. Add temperature rise or layer-transition requirements when known. The rule applies uniformly to the net.
- Use semantic impedance in `signalNet` or `diffPair` only with verified stack/reference information.
- Use `diffPair` for differential pairs and `matchedGroup` for independent nets that require matched lengths; see below.
- Use `drc(...)` and `netClass(...)` for real fabrication limits, not guessed geometry.

A logical high-speed or differential path may cross series resistors, AC-coupling capacitors, ferrite beads, or common-mode chokes and therefore use different physical net names on each side. Trace the complete logical path and apply the appropriate intent to every routed segment; a net-name boundary does not make the downstream segment ordinary. Do not extend the path through shunt or protection branches.

Use semantic intent to derive current and impedance geometry. Explicit dimensions, including ground repair widths, should come from the user, fabricator, pad geometry, or a verified requirement.

## Differential pairs and matched lengths

Declare a differential pair with `diffPair`: the two legs need adjacent, coupled routing as well as acceptable skew. Keep both legs in the same routing job. For example, after confirming these actual net names:

```js
onlyNets({nets:["USB_D+", "USB_D-"]});
diffPair({ id: "USB", positive: "USB_D+", negative: "USB_D-" });
runAll();
```

Add `impedance`, `gapMm`, `maxSkewMm`, and `maxUncoupledLengthMm` from the actual interface requirements and physical stack. The example declares the pair relation; it does not establish an impedance target or sign off its geometry. Verify that both tracks follow the same corridor with suitable spacing, short uncoupled escapes, compatible transitions and a continuous reference.

Use `matchedGroup` for independent nets whose lengths must match, such as related bus signals. It constrains length without requiring adjacency: equally long routes can traverse opposite sides of the board. It cannot replace `diffPair`. When a differential path crosses series components, declare each physical pair segment and review the complete logical path.

## Existing DRC relations

Before changing existing net-class, differential-pair, or matched-length membership, call `get_pcb_drc_rules` once. It returns the compact authoritative relation state.

- `netClass`, `diffPair`, and `matchedGroup` upsert complete definitions and may replace membership.
- Use `assignNetsToNetClass`, `removeNetsFromNetClass`, or `unassignNetClass` for a targeted class edit.
- Use `addNetsToMatchedGroup`, `removeNetsFromMatchedGroup`, or `moveNetsToMatchedGroup` for a targeted matched-group edit.
- Use `deleteNetClass`, `deleteDiffPair`, or `deleteMatchedGroup` only when deletion is intended.

Do not reconstruct unrelated relations from memory or from a large PCB dump.

## Copper layers and physical assumptions

For a new or full routing job, declare the intended copper-layer structure with `stack(...)`. Resolve missing physical values instead of silently dropping stack-dependent intent:

1. Use the user's or fabricator's verified stack when available.
2. For an ordinary non-impedance prototype with no contrary evidence, a provisional `1.6 mm` FR-4 board and `1 oz` copper is a reasonable assumption. Declare it and report it to the user.
3. Ask for the fabricator stack when controlled impedance, flex construction, unusual thickness, inner-layer current capacity, or another requirement depends on dielectric or copper geometry.
4. Never omit `powerNet`, impedance, or another requested semantic method merely because stack data is missing. Either state a provisional stack or ask for the missing data.

Ordinary two-layer provisional example:

```js
stack({
  boardThicknessMm: 1.6,
  fallbackCopperThicknessOz: 1,
  layers: [
    { kind: "copper", name: "TOP" },
    { kind: "copper", name: "BOTTOM" },
  ],
});
```

EasyEDA accepts an even copper-layer count from 2 to 32. The routing job applies this count before validating routed layers. EasyEDA does not persist dielectric thickness, material, permittivity, copper thickness, or other full physical stack properties; it returns `EASYEDA_STACKUP_LAYER_COUNT_ONLY` when only the layer count is applied.

`fallbackCopperThicknessOz` is used for current-derived `powerNet` width when a layer has no explicit copper thickness. Impedance calculation requires usable copper and dielectric geometry, permittivity, and a reference plane; a board-thickness number alone is not enough. Report all provisional values and that only the copper-layer count is written to EasyEDA.

For the first controlled-impedance job, identify the reference plane before routing. The current compiler needs a solid imported reference or a `plane(...)` declaration as well as the physical stack; a reference-net name alone is insufficient. A declared plane is also generated after that job's routing, so it is not a planning-only statement. Retain the resulting zone when it supports the chosen routing strategy. If it blocks a necessary later route, temporarily remove the identified obstructing zone using scoped cleanup, preserve useful critical copper and rebuild the required pour afterward. Clearing a zone solely to follow the suggested stage order is unnecessary. Do not drop the impedance requirement to bypass missing reference data.

## Preserve and clear

Existing tracks, vias, and zones are fixed obstacles and are preserved by default. To replace existing copper, declare the exact scope in the same DSL:

```js
clearRouting({ nets: ["USB_D+", "USB_D-"], items: ["tracks", "vias"] });
```

Before repairing signals blocked by existing ground fill or stitching, inspect the affected ground copper and clear the obstructing object types in the repair job. For example, when both GND zones and vias can be regenerated:

```js
clearRouting({ nets: ["GND"], items: ["zones", "vias"] });
```

This selects **all zones and all vias on GND**, not only stitching vias. The selector has no stitching-only or local-region filter. Use `items: ["zones"]` when only pours obstruct the repair; include `vias` only after accounting for ordinary ground connections that must be rebuilt. Add `tracks` only when ground tracks also need replacement. Use the actual net names and preserve unrelated copper. If the net-wide selection would remove ground connections that must stay, use a precise [execute_js edit](../execution/instructions.md) of identified objects instead.

Keep deferred ground copper declarations out of the repair job so they do not immediately refill the cleared space. Retain passage-protecting GND tracks whenever possible. After signal repairs, rebuild removed ground connections, pours and stitching, then verify the complete board again.

Do not add `clearRouting({ nets: "all" })` by habit. A separate clear tool is not part of this workflow.

## Select one terminal

End every DSL file with exactly one terminal:

- `applyDrcRules()` for rules only;
- `applyStackup()` for copper-layer count only;
- `runCopper()` for selected polygons, planes, or stitching without ordinary signal routing; enabled TAP may still require a routing call. `along` can follow retained existing tracks and `return` can use retained existing signal vias; if the required source routing does not exist, use `runRouting()` or `runAll()`;
- `runRouting()` for routing without applying DSL DRC changes;
- `runAll()` for the job's rules, layer count, copper, and routing intent.

## Run and verify

1. Open the target PCB and call `get_pcb_stack_layers` when current layers affect the decision.
2. For full-board routing, review complete connectivity once and classify every connected net; use targeted inspection for a partial operation. Confirm that the placement and intended layers provide plausible corridors and package escapes before starting the router.
3. Write the next DSL job for the chosen board-specific strategy and call `run_pcb_router_dsl({ file })`. Use the single-call or scoped strategy above, keeping ordinary ground connections pour-first and repairing them only after fill verification. Preserve useful copper and verify affected requirements as work advances.
4. If it returns `status: "running"`, call `wait_operation({ operation_id })` until terminal and use its progress to follow the attempt. Follow [operation results](../operations.md) for completion, cancellation, and application errors.
5. Apply [routing verification](verification.md) to the result. A useful `partial` result is already applied; diagnose its remaining work before choosing a repair.
6. Repair a concrete blocker using the procedure below, then recheck the affected scope. For full-board work, continue remaining groups and final ground completion. Stop at the requested boundary and report the verified result and unresolved findings.

## When routing does not converge

1. Identify the failing nets and location from diagnostics, progress, `inspect_net` and a focused `preview_pcb`. Distinguish an incomplete connection, a rule conflict, obstructing copper and a blocked package escape.
2. Correct the cause with a scoped DSL job. Preserve useful copper, include both legs of a pair and clear only diagnosed blockers. Keep actual fabrication and electrical limits.
3. Use [execute_js](../execution/instructions.md) when a precise native edit is clearly simpler or the DSL cannot express the needed repair. Examples include a local copper keepout or editing one identified obstructing object. Inspect native geometry and API semantics first; a placement exclusion is not a copper keepout. Rebuild affected pours and repeat [routing checks](verification.md) afterward.
4. If routing still cannot make progress, review the [placement](../pcb-layout/verification.md): component orientation, local density, pad escape and corridor width may be the cause. Identify the specific component or local block that needs moving. Revise it through the [placement workflow](../pcb-layout/instructions.md#iterative-local-corrections), including a focused script where appropriate, when the requested scope permits placement changes. For routing-only work, report the proposed layout change before expanding scope.

Continue targeted attempts while they produce measurable progress, such as fewer unconnected pads or blocking violations without breaking successful routes. Change the hypothesis or approach when the same failure repeats or fixes oscillate. There is no fixed attempt count; respect any user time budget and stop when requirements are met or no justified next correction remains. Report a remaining blocker with its net, location and required change.

The routing apply step uses one EasyEDA checkpoint recovery boundary and restores automatically on an application exception. A useful incomplete result remains applied, as does a successfully applied result with non-catastrophic DRC diagnostics, until the agent chooses to keep, repair, or restore it after verification. EasyEDA applies through vias and simple copper-zone outlines. The router decomposes requested regions with holes into simple outlines while retaining excluded areas.

Rely on the automatically created checkpoint; no separate pre-routing snapshot is needed. Retain the `checkpointId` returned by the applied routing result and use that exact ID if a manual restore is later required. Do not substitute a newer checkpoint created by subsequent inspection or repair work.

Ground-reference background: [TI, High-Speed Layout Guidelines (SCAA082A)](https://www.ti.com/lit/pdf/SCAA082A) explains why gaps in a reference plane disrupt signal return paths. Evaluate the final reference copper even when ground connectivity checks pass.


## Layers reserved for planes

EasyEDA WASM is the only routing backend for all supported copper-layer counts.

Set `disableRouting: true` on a copper entry in `stack.layers` to forbid new tracks on that layer for every net. For example, a copper entry in a complete four-layer stack can be:

```js
{ kind: "copper", name: "INNER_1", thicknessOz: 1, disableRouting: true }
```

Keep the other copper and dielectric entries in their physical order with the actual board parameters. Do not copy a guessed stack merely to disable a layer. Omitted `disableRouting` means false. Declare the policy in each routing program that needs it; it is not a persistent EasyEDA editor setting.

The layer remains available for planes, impedance reference calculations and through-via spans. Existing tracks are not cleared by this declaration. Per-net `allowedLayers` can narrow the enabled set but cannot re-enable a disabled layer; an empty intersection for a routed net is rejected before routing. WASM receives one common layer mask. Different masks on unfinished nets are explicitly rejected; this may also occur when impedance selection narrows only one net to a layer. Returned copper is checked for new tracks on disabled layers. This does not prohibit via barrels or via annular rings on a plane layer.


## Matching, transitions and result reports

Declare length matching with `matchedGroup({id:"header",nets:["A","B"],toleranceMm:0.5})`.
For a branched net, select the intended route using `endpoints`, for example
`{net:"A",from:pad("J1",1),to:pad("U1",3)}`. Unselected branches do not become
additional matching terminals. The tuner adds local length without moving
neighboring routes; a lack of legal space remains an unmet requirement.

For delay matching use `delay:{tolerancePs:5,referenceNet:"GND"}` instead of length
fields. Supply physical dielectric data. Delay includes a simplified flight-time
estimate for vias on the selected path, between actual entry and exit layers.
This is an approximation, not certification of via parasitics, stubs or high-speed
signal integrity. Missing stack/reference data remains unchecked. Matching a
coupled differential pair as a group is not supported by the local tuner.

Suitable junctions between a wide and a narrow track are smoothed automatically
with short track segments. Pad and via connections do not receive teardrops.
Impedance and other already satisfied requirements must remain
satisfied; an unsafe expansion is skipped. No additional DSL command is required.

The result contains `content` (a short English digest), `report_path` (always the
full JSON report), `operation_id`, application/checkpoint information and an
artifact directory. The digest includes at most 30 grouped problems. Read the
full report when a problem is omitted or you need measured/required values,
object references, coordinates or assumptions. It includes all local validation
findings and the native DRC returned during application. The existing MCP response
size policy can save a large response to a separate file; follow that path too.
Native DRC errors or pending refill prevent a `complete` application status.

Delay/selected-path matching requirements cannot be persisted as native
whole-net equal-length rules. Retain the DSL for subsequent runs. Physical stack
persistence remains limited to the copper-layer count.

## Fill settings

Use `zone.fill.style` of `solid`, `grid` or `grid45`; grid dimensions follow
EasyEDA's native preset. Arbitrary hatch width, gap and orientation are not DSL
parameters. Until actual native grid geometry is available, local grid-fill
connectivity/electrical checks can remain unchecked; do not substitute a solid
fill and call the requirement passed. Inspect native refill and DRC.

Use `zone.preserveIslands:true` to retain islands, or `false` to remove isolated
copper. There is no area threshold. Thermal options are `mode`, `thermalGapMm`
and `spokeWidthMm`; spoke count and angle follow the native rule. EasyEDA applies
these rules per net, so avoid conflicting thermal settings for zones of one net.

```js
plane({net:"GND", layers:"BOTTOM", zone:{
  fill:{style:"solid"}, preserveIslands:false,
  padConnection:{mode:"thermal", thermalGapMm:0.2, spokeWidthMm:0.3}
}});
runCopper();
```
