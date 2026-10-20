# Electrical layout rules

These are the electrical rules that kept coming back while reviewing placements and routes made with this MCP. They are general engineering, not tool quirks. This file keeps them as decisions with numbers, and says where the tools help or fall short. The numbers are rules of thumb: the device datasheet and the fab's capabilities override them. For depth, see [Further reading](#further-reading).

## 1. Classify the nets before placement

- **Fast means a fast edge, not a high clock.** The knee frequency is about 0.35–0.5 / rise time, and about 2.5 × the bit rate for serial links. A 10 MHz SPI with 2 ns edges carries content up to about 250 MHz.
- **A net is a transmission line when it is long compared with the wavelength.** The usual threshold is a length above about λ/12 at the knee frequency. On FR-4, signals travel at roughly 150 mm/ns on inner layers and 175 mm/ns on outer layers, so:

| Knee frequency | λ on FR-4 | Treat as a line above |
|---|---|---|
| 50 MHz | ~3 m | ~250 mm |
| 100 MHz | ~1.5 m | ~125 mm |
| 500 MHz | ~300 mm | ~25 mm |
| 1 GHz | ~150 mm | ~12 mm |

- **Count any off-board cable in the length.** A short trace that continues into a 1 m cable is a long line.
- **Delay on FR-4** is about 5.7 ps/mm on outer layers and 6.7 ps/mm on inner layers (roughly 145 and 170 ps/in). Use it to turn skew budgets into length budgets: 1 mm of mismatch is about 6–7 ps.
- **Write the classification into the schematic before layout**: impedance class per net, `_P`/`_N` names for pairs, and which nets carry high current. The placement DSL and the router can only respect what the schematic declares.
- **Group each interface's parts on one schematic page** (Ethernet PHY and magnetics, USB connector and ESD), so the placement blocks follow function.

## 2. Impedance targets and stackup

- **Take the target from the datasheet of each interface.** Typical values, all ±10–15 %:

| Interface | Differential | Single-ended |
|---|---|---|
| USB 2.0 / 3.x | 90 Ω | 50 Ω |
| PCIe (gen 3 and later; earlier gens 100 Ω) | 85 Ω | 50 Ω |
| Ethernet (MDI), HDMI, MIPI D-PHY, SATA, LVDS | 100 Ω | 50 Ω |
| RS485 / CAN (termination; board traces short and not critical) | 120 Ω | — |
| RF lines, antennas | — | 50 Ω |
| Video (analog) | — | 75 Ω |

- **Compute widths and gaps with the fab's own stackup and calculator** (for JLCPCB, one of its listed stackups). Read the board layers with `get_pcb_stack_layers`. Do not assume a datasheet εr: the same coplanar geometry gave about 50 Ω on one board and 57–62 Ω on another.
- **Ask the fab for impedance control on those layers**: a target impedance per layer, checked with coupons, typically ±10 %. Asking only for "controlled dielectric" (thickness held to about ±10 %) does not guarantee the impedance.
- **Give controlled traces a width that no other trace uses** (for example 0.127 mm when the other signals use 0.15 mm), so the fab can identify them. List the target per layer in the fab notes.
- **Geometry sanity limits** that keep a pair buildable and predictable:
  - the gap inside a pair at most 2 × the trace width;
  - the trace width at most 2 × the height to the nearest plane;
  - signal layers within about 0.25 mm of their reference plane.
- **On four or more layers, every signal layer needs an adjacent solid plane.** Fast nets go on the layers next to ground. A common 4-layer order is signal, ground, power, signal, with the components on the side next to ground.
- **Stack the board symmetrically and keep its build simple**:
  - no more than about three prepreg types, each thinner than about 0.25 mm;
  - avoid high-glass, low-resin prepregs (7628, 2116) where impedance matters.
- **Choose the laminate by loss at the knee frequency**:
  - standard FR-4 is fine up to about 2.5–3 GHz;
  - mid-loss materials up to about 10 GHz;
  - low-loss or PTFE materials (Rogers class) above that, or for RF lines that must stay precise.
  - FR-4's εr falls with frequency (about 4.7 to about 4 above 5 GHz), which smears fast edges.
- **On fast pairs, open glass weave causes skew.** One line can sit over glass and the other over resin. Use a tight weave or spread glass, or route pairs at a small angle to the weave.

## 3. Placement

- **Place in this order**:
  1. Connectors and main ICs, as the mechanics and the signal flow require.
  2. Their crystal, decoupling and termination parts.
  3. Everything else.
  - Terminations placed last end up with stubs. Series resistors go right after the driver pin; parallel ones go at the receiver pin with the shortest stub.
- **Floorplan by function** (power, RF, digital, analog) so that no signal has to cross another block. Keep switching supplies away from RF and analog inputs. Never place one block's parts inside another block's area.
- **Keep fast parts and their nets away from the board edge and from unrelated connectors.** Impedance changes near the edge and connectors radiate. The exception is the connector's own interface.
- **Put protection parts at the connector they protect**, on the cable side, with no via between the connector and the clamp.
- **Align similar parts in the same direction**, and keep SMD parts on one side when possible. Both help assembly and the router.
- **Decide where heat goes** before placing a part that dissipates. The chain is: thermal pad, then vias, then a copper area on both sides, then airflow or the enclosure.
  - FR-4 conducts 0.2–0.5 W/m·K, against 386 W/m·K for copper: heat must travel through copper.
  - Keep tall parts out of the airflow to hot parts.
  - Consider a metal-core board for power LEDs and dense power stages.

## 4. Routing: the return path

- **For every fast net, check the reference under its whole length** with `inspect_net` and the layer fills.
  - A trace over a split, a slot or a row of via antipads forces the return current to detour, and the loop radiates.
  - Keep the plane at least 3 trace widths beyond each side of the trace.
- **Space vias about 0.4 mm apart in dense areas** so the plane passes between their antipads; a row of touching antipads is a slot.
- **When a fast net changes layer, put a ground via next to the signal via**, between the two vias of a pair if possible.
  - If the new reference is a different net (a power plane), put a 10–100 nF capacitor between the two references next to the crossing.
  - If both references are ground, a copper bridge under the trace is better than a capacitor.
- **Put ground vias at both ends of a fast net**, at the driver and at the receiver, so the return uses the plane and not a thin ground trace.
- **Prefer ground over power planes as reference.** When a power plane must serve, the decoupling capacitors at both ends double as return paths if they sit at the signal's entry and exit.
- **Crosstalk**:
  - keep about 3 trace widths between unrelated fast nets, more for clocks;
  - shorten parallel runs;
  - route adjacent layers crosswise;
  - keep traces close to their plane;
  - if a guard trace is needed, ground it with vias along its length, because a floating guard couples.
- **Avoid stubs**: route pull-ups and pull-downs on fast nets as a daisy chain through the resistor pad, and avoid T branches.
- **Use few bends, at 135° or arcs.** Avoid acute angles; 90° corners are a manufacturing issue more than an electrical one at these speeds.
- **One solid ground beats split grounds.** If a converter needs a quiet area, keep that area's traces from crossing the dividing line instead of cutting the plane. If the plane must be split, join the parts at one point near the converter (ferrite or 0 Ω) and route every crossing trace over that point.

## 5. Differential pairs

- **Keep both lines together, symmetric, on the same layer and with the same number of vias.**
  - Nothing goes between them, neither vias nor parts.
  - Keep pair-to-pair spacing at least 5 × the trace width, about 0.75 mm to other nets and about 1.25 mm to clocks.
- **Place AC-coupling and ESD parts symmetrically**, in the smallest package that suits (0402; avoid 0805 and arrays). Put a ground via next to each pair of layer-change vias.
- **Match length segment by segment**, close to the bend or via that creates the mismatch.
  - A match on the total length can hide a large mismatch in between, and DRC only checks the total.
  - Two opposite bends less than about 15 mm apart cancel each other.
  - Serpentines need a gap of at least 4 × the trace width between turns and straight segments of at least 1.5 × the width.
  - A symmetric breakout from the pads is better than any serpentine.
- **Check how the tool counts length**: some count the trace inside a pad, so give both lines the same pad entry.
- **A `diffPair` in `run_pcb_router_dsl` rewrites the DRC rules** (see [routing](routing-and-api.md)). Apply tight skew only where needed:

| Interface | Intra-pair skew to target |
|---|---|
| USB high speed (480 Mb/s) | ≤ ~1 mm (vendor limits range from about 0.15 to 1.25 mm) |
| Ethernet 100 Mb/s | ≤ ~1.25 mm |
| USB full speed (12 Mb/s), RS485, CAN | not critical |

  Check each value against the PHY or controller datasheet.

## 6. Decoupling and power delivery

- **The mounting loop matters more than the capacitor.** The internal ESL of an 0402 MLCC is about 0.5–1 nH, but its pads, traces and vias easily add a few nH.
  - Put the via to the plane at the pad, keep traces short and wide, and keep the power and ground planes close together.
  - Two vias spaced 1 mm apart through a 1.6 mm board add roughly 1.5 nH.
- **Each MLCC only helps around its self-resonance.** Typical values for 0402–0805:

| Value | Self-resonance |
|---|---|
| 10 µF | ~2–3 MHz |
| 1 µF | ~6–10 MHz |
| 100 nF | ~20–30 MHz |
| 10 nF | ~70–90 MHz |
| 1 nF | ~200–300 MHz |

  Smaller packages resonate higher. Several identical capacitors divide the ESL. Two different values in parallel create an impedance peak between their resonances; fill it with a third value or use one value. Very low ESR makes that peak higher.
- **For a large or fast digital load, size decoupling against a target impedance**: Z_target = rail voltage × allowed ripple / (0.5 × peak current).
  - Example: a 3.3 V rail with a 500 mA radio burst and 5 % ripple gives Z_target ≈ 0.66 Ω, easy with a few MLCCs and a bulk capacitor.
  - A 1.2 V core at 2 A and 3 % gives about 36 mΩ, which needs planes and many capacitors.
  - The regulator covers up to a few kHz, bulk capacitors from about 1 kHz to 100 kHz, MLCCs from about 100 kHz to 100 MHz, and a close plane pair the hundreds of MHz.
- **Check each capacitor's band against the target impedance.**
  - A bulk capacitor works below about √(Z_target² − ESR²) / (2π · ESL); above that it is inductive.
  - For MLCCs, the count needed is roughly the mounted ESL per capacitor divided by the ESL that meets the target at the top frequency.
  - Choose bulk ESR around half the target, not the lowest available.
- **A close power/ground plane pair is a capacitor**: about εr · 0.00885 · A / h pF, with A in mm² and h in mm. A 100 × 60 mm pair 0.1 mm apart gives about 2 nF, useful around 100–200 MHz.
- **Size tracks and vias for current and temperature rise** (IPC-2152), and check the voltage drop on long rails.
  - A plated via (standard plating, 5 °C rise) carries roughly 0.8 A with a 0.2 mm drill, 1.1 A with 0.3 mm and 1.6 A with 0.5 mm. Use several vias for power.
- **Filter at the board boundary.**
  - Interference below about 30 MHz is mostly conducted through cables and supplies: use a ferrite bead plus a capacitor on supply inputs, and filters on I/O lines.
  - Above about 30 MHz it is mostly radiated: keep loops small, edges slow and shields grounded.
  - Use the slowest logic edges that meet timing.

## 7. Vias and footprints

- **Smaller vias have less capacitance; short, wide vias have less inductance.** On fast lines, put the via at the pad or in it.
  - A via in a soldered pad must be filled and capped, or solder wicks away.
  - Under a BGA, every via in the pad array must be filled.
  - A QFN thermal pad needs vias, with the paste split into windows.
- **The unused part of a via barrel is a stub that resonates**: on multi-GHz lines, change layer to the far side or ask for back-drilling.
- **Keep aspect ratio within the fab's limit** (about 10:1 for through holes, 1:1 or less for microvias), and prefer staggered to stacked microvias.
- **Choose packages to suit fast lines.** For example, choose a package whose pads are close to the 50 Ω trace width, and keep pads no larger than the assembly needs, because extra copper adds capacitance.

## 8. Two-layer boards

- **Keep a solid ground under the most critical section** (radio, USB, switcher loop).
  - Route mostly on top, pour ground on both sides, and stitch the pours densely, every few millimetres along fast lines and around the RF section.
- **Decide before routing which long nets may cut the bottom pour** (see [routing](routing-and-api.md)).
- **Flag any fast interface that cannot get a continuous reference.** It is a design decision for the user, not something to hide in DRC.

## 9. Fab notes and release checks

- **Fab notes**:
  - IPC class (2 for most products, 3 for high reliability);
  - impedance per layer with the trace widths;
  - stackup with copper and dielectric per layer;
  - filled via-in-pad where used;
  - at least three fiducials for assembly.
- **Before ordering**:
  - DRC clean and routing complete;
  - every SMD pad has mask and paste openings;
  - polarity and pin 1 marked;
  - Gerbers inspected in a viewer (copper islands, mask and paste alignment);
  - BOM validated against part numbers.
  - See also [manufacturing](manufacturing.md).

## Further reading

These conclusions were cross-checked against general references. None of their text or tables is reproduced here:
- the IPC-2221/2152 family, for conductor and via sizing;
- Sierra Circuits, *High-Speed PCB Design Guide* (2020);
- N. Kardam, *Introduction to Printed Circuit Board Design and Layout using KiCad* (LWTech, 2024).
