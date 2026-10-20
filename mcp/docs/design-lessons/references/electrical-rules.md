# Electrical layout rules

These are the electrical rules that kept coming back while reviewing placements and routes made with this MCP. They are general engineering, not tool quirks, so this file keeps them short and points out where the tools help or fall short. For depth, see [Further reading](#further-reading).

## Before placement: classify the nets

- **Decide which nets are fast from edge rate and length, not from clock frequency.**
  - Knee frequency ≈ 0.35–0.5 / rise time.
  - A net is a transmission line when its length is more than about a tenth of the wavelength at that frequency. On FR-4 that wavelength is roughly 150–175 mm / f(GHz).
  - Count any off-board cable in the length.
  - A 50 MHz bus can be harmless on a small board and still radiate through a long cable.
- **Write the result into the schematic before layout**: impedance class per net, `_P`/`_N` names for pairs, and which nets carry high current. The placement DSL and the router can only respect what the schematic declares.
- **Take impedance targets from the datasheet of each interface.** The usual values are 90 Ω differential for USB, 100 Ω for Ethernet and LVDS, and 50 Ω single-ended for RF. Never assume them.

## Stackup and impedance

- **Compute widths and gaps with the fab's own stackup and calculator** (for JLCPCB, its listed stackups). Read the board layers with `get_pcb_stack_layers`. Do not assume a datasheet εr: the same geometry gave different impedances on different boards.
- **On four or more layers, give every signal layer an adjacent solid plane**, and keep fast nets on the layers next to ground.
- **Give controlled-impedance traces a width that no other trace uses**, so the fab can find them, and list the target impedance per layer in the fab notes.

## Placement

- **Place in this order**:
  1. connectors and main ICs;
  2. their crystal, decoupling and termination parts;
  3. everything else.
- Terminations placed last end up with stubs: series resistors belong at the driver, parallel ones at the receiver.
- **Keep fast parts and their nets away from the board edge and the connectors**, unless they are the connector's own interface.
- **Put protection parts at the connector** they protect, on the cable side, with no via between the connector and the clamp.
- **Decide where heat goes** before placing a part that dissipates: thermal pad, then vias, then a copper area on both sides, then airflow. FR-4 conducts about a thousand times worse than copper.

## Routing: the return path

- **For every fast net, check the reference under its whole length.** A trace over a split, a slot or a row of via antipads forces the return current to detour, and the loop radiates.
- **When a fast net changes layer, put a ground via next to the signal via.** When it changes to a reference on a different net, put a 10–100 nF capacitor next to the crossing.
- **Put ground vias at both ends of a fast net**, at the driver and at the receiver, so the return uses the plane and not a thin ground trace.
- **Keep about three trace widths between unrelated fast nets**, shorten parallel runs, and route adjacent layers crosswise.
- **Prefer one solid ground** over split grounds. If a converter needs a quiet area, keep that area's traces from crossing the dividing line instead of cutting the plane.

## Differential pairs

- **Keep both lines together, symmetric, on the same layer and with the same vias.** Nothing goes between them; AC-coupling and ESD parts are placed symmetrically and as small as possible.
- **Match length segment by segment**, close to the bend or via that creates the mismatch. A match on the total length can hide a large mismatch in between, and DRC only checks the total.
- **A `diffPair` in `run_pcb_router_dsl` rewrites the DRC rules** (see [routing](routing-and-api.md)). Apply tight skew only to interfaces that need it, such as USB high speed, not to full-speed USB or RS485.

## Decoupling and power

- **The mounting loop matters more than the capacitor value.**
  - A capacitor with long thin traces or a shared far via does little at high frequency.
  - Put each small capacitor at its pin, with its via to the plane at the pad.
- **For a large or fast digital load, size decoupling against a target impedance** (allowed ripple divided by about half the peak current) instead of copying a pattern.
  - Bulk capacitors cover the low-frequency end and small MLCCs the high end.
  - When mixing values, check that their anti-resonance peak stays below the target.
- **Size power tracks and vias for current and temperature rise**, and check the voltage drop on long rails. A 0.3 mm drill via carries roughly 1 A.

## Two-layer boards

- **Keep a solid ground under the most critical section** (radio, USB, switcher loop). Route mostly on top, pour ground on both sides and stitch the pours densely.
- **Flag any fast interface that cannot get a continuous reference.** It is a design decision for the user, not something to hide in DRC.

## Further reading

These conclusions were cross-checked against general references. None of their text is reproduced here:
- the IPC-2221/2152 family, for conductor sizing;
- Sierra Circuits, *High-Speed PCB Design Guide* (2020);
- N. Kardam, *Introduction to Printed Circuit Board Design and Layout using KiCad* (LWTech, 2024).
