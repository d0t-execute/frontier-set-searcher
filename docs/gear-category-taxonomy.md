# Gear category taxonomy

Maps the reference MHF set-searcher's two category trees (equipment, and
decorations/cuffs) onto the raw fields this project already scrapes out of
`skill/equip.js` (see `docs/data-format-notes.md`). Confirmed against the
real cached dataset (61,817 armor rows, 6,040 deco/cuff-bucket rows) by a
dedicated research pass, then corrected against the user's own screenshots
of the reference tool's actual category trees and example items.

Confidence tags: **HIGH** = the field combination alone, reliably, matches
the reference tool's bucket. **INFERRED** = the field combination is a very
strong fit but wasn't independently cross-checked name-by-name. **CURATED**
= resolved only by an explicit user-provided item-name list (no field
combination distinguishes it); the ETL will need a hardcoded lookup table
for these, the same way the `EXa`/`PostZ`/`PreZ` GX named-series groups
already are.

Field shorthand used below: `CRE` (acquisition-method code, 2 chars, first
char = category + rest = submode), `CLASS` (origin-tier code), `TYPE`
(column 2: 0=Common/1=Blademaster/2=Gunner — not currently parsed, see
"TYPE field" below), and the GX/G/HS/etc. name-suffix tokens embedded in
item names.

A general, confirmed rule across every bucket below: wherever a slot has
two body-armor names (e.g. Mail/Vest, Arms/Guard, Faulds/Coat, Feet/Boots),
that pair is a Blademaster/Gunner split of the *same* category, driven by
`TYPE`, not two different categories. Head pieces with two names (e.g.
Helm/Cap) are both `TYPE=0` (Common, weapon-class-agnostic). Confirmed
exhaustively for the Tower family (every body slot splits exactly 42
Blademaster + 42 Gunner across all 420 Tower rows) and for every other
multi-name family checked. `TYPE` does not change which *category* a row
belongs to anywhere in this taxonomy — every TYPE variant of an item stays
in the same leaf — it's independently useful as its own filterable
dimension (not required for this taxonomy to work).

**Update (2026-10-20, F/FZ and G/GF split):** every "plain" (`CLASS ""`) leaf's F and
FZ(/FY)-name-suffix rows, and every G-rank leaf's G and GF-name-suffix rows, used to be merged
together across this whole taxonomy. Direct stat comparison against the real dataset (RARE/DEF/HR1
strictly increasing across a given item's own upgrade chain, e.g. Package's "Secuti": RARE 7/DEF 13
(plain) -> RARE 7/DEF 50 ("F") -> RARE 7/DEF 88 ("FZ"); Festival's "Roses": RARE 8/DEF 137 ("G") ->
RARE 10/DEF 146 ("GF") -> RARE 11/DEF 233 ("GX"), all `TYPE=0` so not a Blademaster/Gunner naming
pair) confirmed these are genuine, separate tiers, not naming variants -- so every such leaf below now
splits into its own F/FZ or G/GF leaf (`_f_or_fz`/`_g_or_gf_or_gx` in gear_category.py). "FY" is a
differently-worded name for the same tier-2 position as "FZ" (a given item's own chain uses either FY
or FZ, never both) and maps to the same `_fz` leaf. Two nested discoveries fell out of this pass:
G-Hiden (`CLASS L`) and Exotic (`CLASS O`) each carry their *own* internal G/GF/GX escalation on top
of already being G-rank via `CLASS` alone -- G-Hiden has no "plain" variant at all (100% of real rows
carry G, GF, or GX), Exotic has a plain variant plus all 3 (4 tiers total). This pass also opportunistically
fixed several pre-existing glued-marker bugs found by the same audit, where a plain `"GX" in tokens`
membership check missed a GX marker glued directly onto following text with no separating space (e.g.
"White Fatalis GXクロウ", "Brooke GXグローブ", "Tempest GX【衣】") and silently misclassified those
rows into the tier below GX instead -- these are now found correctly via the same regex-based
`_has_marker` helper the GS/GP split already used. **Event's own G/GF merge is a confirmed,
intentional exception** (see "Event Armour" below) and was *not* touched by this split; its F/FZ did
split, since that part of the reference-tool screenshot evidence only covered G/GX. Musou and Extreme
Quest Armour additionally changed shape entirely, from one leaf per monster/quest to one leaf per
G/GF/GX tier (see their own section below).

## Tree 1: Equipment

### Paid and Premium

**Update (2026-10-20, ZP is its own "Gear levels" tier):** the "ZP" (Zenith-Shugo) leaf wherever it
appears below (and in Hunting Tournament) used to count as "Zenith" for the "Gear levels" quick-toggle
UI (added earlier the same day as part of the "Z and up" ladder rule), but the project owner has since
split it out into its own 4th top-level tier instead -- see `GEAR_LEVEL_ZP_CATEGORIES` in
gear-categories.ts. This is purely a "Gear levels" UI-tier change; the leaves/rules/counts themselves
are unaffected.

**Update (2026-10-18):** each of the 5 routes below splits further by CLASS (confirmed against the
real dataset, via `_paid_premium_subcategory` in gear_category.py) -- a complete partition, not a
guess: every route's own sub-counts sum exactly to its un-split total. Name-suffix tokens (HS/GS/GP/
HC/ZP) corroborate each CLASS value but aren't needed to decide the leaf, except GS vs. GP themselves
(see next update).

**Update (2026-10-20):** "G-Shugo" (the `CLASS J` tier) used to be one leaf merging 2 real,
evenly-split name-suffix variants ("GS"/"GP"). The project owner asked for these split to mirror the
in-game piece names, since the GS/GP marker is readable straight off every row's own name (it just
isn't always a whitespace-delimited token -- confirmed in the real data to sometimes glue directly
onto a kana series name, e.g. "メトリーGS Helm・Blue"). Re-confirmed against the real dataset while
splitting this: every route's GS+GP sub-counts still sum exactly to its old merged total; Premium
Kit/Gachapon/Net Cafe split exactly in half, Package (440/360) and Promotional (230/203) split close
to but not exactly in half -- a real asymmetry in the game data, not an audit artifact. "Package ZP"
(the reference tool's `CRE=5p` + `CLASS Q` leaf) was also investigated per the project owner's
question and is confirmed genuinely empty -- 0 rows carry a "ZP" marker anywhere under `CRE=5p`, the
only one of these 5 routes without a Zenith-Shugo tier; same no-leaf-for-confirmed-empty convention as
Subscription Period/Taiwanese Premium below.

**Update (2026-10-20):** each route's `CLASS ""` base tier further splits into F/FZ sub-tiers (see the
taxonomy-wide F/FZ/G/GF note above); Gachapon's Hiden/G-Hiden/Exotic sub-leaves also split by their
own internal tier the same way (G-Hiden: no plain variant, 100% G/GF/GX; Exotic: plain + G/GF/GX).

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| Package | `CRE=5p`, `CLASS ""`, no suffix | 454 | HIGH |
| Package F | `CRE=5p` + `CLASS ""` + "F" | 440 | HIGH |
| Package FZ | `CRE=5p` + `CLASS ""` + "FZ"/"FY" | 440 | HIGH |
| Package HS | `CRE=5p` + `CLASS F` | 440 | HIGH |
| Package GS | `CRE=5p` + `CLASS J` + "GS" | 440 | HIGH |
| Package GP | `CRE=5p` + `CLASS J` + "GP" | 360 | HIGH |
| Package HC | `CRE=5p` + `CLASS E` | 80 | HIGH |
| Package ZP | *(no leaf — confirmed empty)* | 0 | CONFIRMED |
| Premium Kit | `CRE=4k`, `CLASS ""`, no suffix | 3,443 | HIGH |
| Premium Kit F | `CRE=4k` + `CLASS ""` + "F" | 3,177 | HIGH |
| Premium Kit FZ | `CRE=4k` + `CLASS ""` + "FZ"/"FY" | 3,262 | HIGH |
| Premium Kit HS | `CRE=4k` + `CLASS F` | 3,262 | HIGH |
| Premium Kit GS | `CRE=4k` + `CLASS J` + "GS" | 3,262 | HIGH |
| Premium Kit GP | `CRE=4k` + `CLASS J` + "GP" | 3,262 | HIGH |
| Premium Kit HC | `CRE=4k` + `CLASS E` | 1,201 | HIGH |
| Premium Kit ZP | `CRE=4k` + `CLASS Q` | 864 | HIGH |
| Gachapon | `CRE=4g`, `CLASS ""`, no suffix | 2,449 | HIGH |
| Gachapon F | `CRE=4g` + `CLASS ""` + "F" | 2,168 | HIGH |
| Gachapon FZ | `CRE=4g` + `CLASS ""` + "FZ"/"FY" | 1,606 | HIGH |
| Gachapon HS | `CRE=4g` + `CLASS F` | 1,626 | HIGH |
| Gachapon GS | `CRE=4g` + `CLASS J` + "GS" | 1,656 | HIGH |
| Gachapon GP | `CRE=4g` + `CLASS J` + "GP" | 1,656 | HIGH |
| Gachapon HC | `CRE=4g` + `CLASS E` | 20 | HIGH |
| Gachapon ZP | `CRE=4g` + `CLASS Q` | 1,056 | HIGH |
| Gachapon Hiden | `CRE=4g` + `CLASS K`, no "F" | 280 | HIGH |
| Gachapon Hiden F | `CRE=4g` + `CLASS K` + "F" | 140 | HIGH |
| Gachapon G-Hiden | `CRE=4g` + `CLASS L` + "G" | 280 | HIGH |
| Gachapon G-Hiden GF | `CRE=4g` + `CLASS L` + "GF" | 280 | HIGH |
| Gachapon G-Hiden GX | `CRE=4g` + `CLASS L` + "GX" | 280 | HIGH |
| Gachapon Exotic | `CRE=4g` + `CLASS O`, no suffix | 62 | HIGH |
| Gachapon Exotic G | `CRE=4g` + `CLASS O` + "G" | 62 | HIGH |
| Gachapon Exotic GF | `CRE=4g` + `CLASS O` + "GF" | 62 | HIGH |
| Gachapon Exotic GX | `CRE=4g` + `CLASS O` + "GX" | 62 | HIGH |
| Net Cafe | `CRE=3-`/`3e`, `CLASS ""`, no suffix | 211 | HIGH |
| Net Cafe F | `CRE=3-`/`3e` + `CLASS ""` + "F" | 282 | HIGH |
| Net Cafe FZ | `CRE=3-`/`3e` + `CLASS ""` + "FZ"/"FY" | 76 | HIGH |
| Net Cafe HS | `CRE=3-`/`3e` + `CLASS F` | 126 | HIGH |
| Net Cafe GS | `CRE=3-`/`3e` + `CLASS J` + "GS" | 126 | HIGH |
| Net Cafe GP | `CRE=3-`/`3e` + `CLASS J` + "GP" | 126 | HIGH |
| Net Cafe HC | `CRE=3-`/`3e` + `CLASS E` | 22 | HIGH |
| Net Cafe ZP | `CRE=3-`/`3e` + `CLASS Q` | 30 | HIGH |
| Promotional | `CRE=5-`, `CLASS ""`, no suffix | 477 | HIGH |
| Promotional F | `CRE=5-` + `CLASS ""` + "F" | 297 | HIGH |
| Promotional FZ | `CRE=5-` + `CLASS ""` + "FZ"/"FY" | 252 | HIGH |
| Promotional HS | `CRE=5-` + `CLASS F` | 230 | HIGH |
| Promotional GS | `CRE=5-` + `CLASS J` + "GS" | 230 | HIGH |
| Promotional GP | `CRE=5-` + `CLASS J` + "GP" | 203 | HIGH |
| Promotional HC | `CRE=5-` + `CLASS E` | 72 | HIGH |
| Promotional ZP | `CRE=5-` + `CLASS Q` | 50 | HIGH |
| Subscription Period | *(no leaf — confirmed empty)* | 0 | CONFIRMED |
| Taiwanese Premium | *(no leaf — confirmed empty)* | 0 | CONFIRMED |

### Guild

**Update (2026-10-20):** the project owner supplied a screenshot of the reference tool's own Guild
node, showing Festival splitting into 9 leaves of its own and Diva Defense nested *under* Guild (not
its own top-level group) and itself splitting into 5 leaves -- both previously single unsplit leaves
in this project. Both splits are confirmed against the real dataset: Festival's 9 leaves sum exactly
to its old 2,548-row total (2,508 + the 40 FX rows that used to be diverted into the shared HR100 FX
bucket), and Diva Defense's 5 leaves sum exactly to its old 410-row total.

Festival's FX rows turn out to belong to Festival itself in the reference tool (the screenshot shows
"FX Festival" as Festival's own child), not merged with `CRE=1-`/`1e`'s FX rows under the shared HR100
bucket as this project previously assumed -- so `paid_premium`'s shared HR100 FX leaf now only covers
`CRE=1-`/`1e` (242 of its previous 282 rows; see "HR100~" below).

**Update (2026-10-20):** Festival's own plain (`CLASS ""`) remainder and its G-rank leaf both split
further by F/FZ and G/GF respectively (see the taxonomy-wide note above); same for 猟.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| Festival | `CRE=2m`, plain `CLASS`, no suffix, not FX/RX/LX/"Winner and Loser Crowns" | 708 | HIGH |
| Festival F | `CRE=2m`, plain `CLASS` + "F" | 311 | HIGH |
| Festival FZ | `CRE=2m`, plain `CLASS` + "FZ"/"FY" | 206 | HIGH |
| Festival FX | `CRE=2m`, plain `CLASS` + FX | 40 | HIGH |
| Festival RX | `CRE=2m`, plain `CLASS` + RX | 25 | HIGH |
| Festival LX | `CRE=2m`, plain `CLASS` + LX | 20 | HIGH |
| Festival HC | `CRE=2m` + `CLASS E` | 86 | HIGH |
| Festival HS | `CRE=2m` + `CLASS F` | 160 | HIGH |
| Festival G | `CRE=2m` + `CLASS I` + "G" | 316 | HIGH |
| Festival GF | `CRE=2m` + `CLASS I` + "GF" | 316 | HIGH |
| Festival GX | `CRE=2m` + `CLASS I` + GX | 316 | HIGH |
| Winner and Loser Crowns | `CRE=2m`, plain `CLASS`, name starts "祭のあとに" | 5 | CONFIRMED — curated name match, no field combination distinguishes these from the other 708 plain Festival rows |
| 猟 (plain) | `CRE=2-`, no suffix | 201 | HIGH |
| 猟F | `CRE=2-`, plain `CLASS` + "F" | 73 | HIGH |
| 猟FZ | `CRE=2-`, plain `CLASS` + "FZ"/"FY" | 10 | HIGH |
| 猟HS | `CRE=2-` + `CLASS F` | 10 | HIGH |
| 猟G | `CRE=2-` + `CLASS I/J` + "G" | 57 | HIGH |
| 猟GF | `CRE=2-` + `CLASS I/J` + "GF" | 57 | HIGH |
| 猟GX | `CRE=2-` + GX suffix | 57 | HIGH |

**Note (2026-10-20 audit):** `CRE=2-` has exactly 2 `CLASS J` (G-Shugo) rows ("Torid GF
Corsage"/"Torid GX Corsage") -- unlike every other G-Shugo occurrence in this taxonomy, these are
named with GF/GX tokens, not GS/GP, so they aren't part of the GS/GP split below; they already land
correctly in 猟G/猟GX via the existing token check above (included in those counts).

### Diva Defense (nested under Guild)

**Update (2026-10-20):** the "Diva Defense (plain)" row is still produced by
the ETL (`CATEGORY_DIVA_DEFENSE`/`diva_defense`), but since it's confirmed
0 real rows it's no longer a UI leaf at all -- removed from this section's
tree rather than kept as an always-empty defensive-default option.

**Update (2026-10-20, Zenith ZF split out):** "Diva Defense Zenith" initially
stayed merged (bare "Z" + "ZF") per the project owner's screenshot of the
reference tool's own tree, which showed no separate "ZF" child here unlike
Road/Event Zenith below. The project owner later decided to split it anyway,
for consistency with Road/Event Zenith's own ZF leaf -- the real dataset
splits cleanly by the same "ZF" name-suffix token (100/100), so the split is
a clean row-count halving, not a guess.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| Diva Defense (plain) | `CRE=2u`, not `CLASS I`/`P` | 0 — confirmed empty, no longer a UI leaf (2026-10-20) | CONFIRMED |
| Diva Defense GX | `CRE=2u` + `CLASS I` + GX ("Burning Cliff"/"Crimson Cliff") | 10 | CONFIRMED |
| Diva Defense Zenith | `CRE=2u` + `CLASS P`, bare "Z" token | 100 | CONFIRMED |
| Diva Defense Zenith ZF | `CRE=2u` + `CLASS P` + ZF | 100 | CONFIRMED |
| Diva Defense Zenith ZY | `CRE=2u` + `CLASS P` + ZY | 100 | HIGH |
| Diva Defense Zenith ZX | `CRE=2u` + `CLASS P` + ZX | 100 | HIGH |

### Tower
**Update (2026-10-20):** 塔's own plain remainder and G-rank leaf both split further by F/FZ and G/GF
respectively (see the taxonomy-wide note above).

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 塔 (plain) | `CRE=1t` + `CLASS N`, no suffix | 60 | HIGH |
| 塔F | `CRE=1t` + `CLASS N` + "F" | 60 | HIGH |
| 塔FZ | `CRE=1t` + `CLASS N` + "FZ"/"FY" | 60 | HIGH |
| 塔HS | `CRE=1t` + `CLASS N` + HS | 60 | HIGH |
| 塔G | `CRE=1t` + `CLASS N` + "G" | 60 | HIGH |
| 塔GF | `CRE=1t` + `CLASS N` + "GF" | 60 | HIGH |
| 刻GX (Customisable Tower GX) | `CRE=1t` + `CLASS N` + GX suffix | 60 (all TYPE variants) | HIGH — confirmed via user screenshots of the actual item names (Cleora/Keisu/Lumiere/Nyui/Once/Ranvuo, all 5 slots) |
| 刻 (Customisable Tower, non-GX) | — | 0 armor rows found | UNRESOLVED — no armor data matches; presumed weapons-only unless you have an example |

### Caravan and Diva Battle (航)
**Update (2026-10-20):** 航's own plain remainder and G-rank leaf both split further by F/FZ and G/GF
respectively (see the taxonomy-wide note above); also fixed a pre-existing glued-marker bug where
"Brooke GXグローブ"/"...ミトン" rows (no space before "GX") were silently misclassified into 航G
instead of 航GX, already reflected in the counts below.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 航 | `CRE=1c` (R/L) + `CRE=1s` (plain) | 90 | INFERRED |
| 航F | `CRE=1s`, plain `CLASS` + "F" | 80 | INFERRED |
| 航FZ | `CRE=1s`, plain `CLASS` + "FZ"/"FY" | 80 | INFERRED |
| 航RX | `CRE=1c` + RX | 5 | INFERRED |
| 航HS | `CRE=1s` + `CLASS F` | 80 | INFERRED |
| 航G | `CRE=1s` + `CLASS I` + "G" | 80 | INFERRED |
| 航GF | `CRE=1s` + `CLASS I` + "GF" | 80 | INFERRED |
| 航GX | `CRE=1s` + GX | 80 | INFERRED |

### Hunter's Road (道)
**Update (2026-10-20):** 道's own plain remainder and G-rank leaf both split further by F/FZ and G/GF
respectively (see the taxonomy-wide note above); also fixed a pre-existing glued-marker bug where
"White Fatalis GXクロウ"/"...フィスト" rows (no space before "GX") were silently misclassified into
the plain leaf instead of 道GX, already reflected in the counts below.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 道 (plain) | `CRE=1t`, not `CLASS N`/`P`, no suffix | 55 | HIGH |
| 道F | `CRE=1t`, plain `CLASS` + "F" | 55 | HIGH |
| 道FZ | `CRE=1t`, plain `CLASS` + "FZ"/"FY" | 55 | HIGH |
| 道HS | `CRE=1t` + `CLASS F` | 55 | HIGH |
| 道G | `CRE=1t` + `CLASS I` + "G" | 85 | HIGH |
| 道GF | `CRE=1t` + `CLASS I` + "GF" | 85 | HIGH |
| 道GX | `CRE=1t` + `CLASS I` + GX | 95 | HIGH — confirmed "just road's gx tier"; includes Nympha/Will/Saint/White Fatalis GX |
| 道辿 (Road Zenith) | `CRE=1t` + `CLASS P` | 120 | HIGH |
| 道辿ZY | `CRE=1t` + `CLASS P` + ZY | 60 | HIGH |
| 道辿ZX | `CRE=1t` + `CLASS P` + ZX | 60 | HIGH |

### G Rank Armour
**Update (2026-10-20):** G splits further into G/GF (see the taxonomy-wide note above). This pass also
discovered that G祕 (`CLASS L`) and 縁 (`CLASS O`) each carry their *own* internal G/GF/GX escalation
on top of already being G-rank via `CLASS` alone: G祕 has no plain variant at all (100% of real rows
carry G/GF/GX), while 縁 has a plain variant plus all 3 (4 tiers total, 110/110/110/110) -- the old
"縁"/"縁GX" 2-leaf shape undercounted the middle two tiers into the plain bucket. Also fixed a
pre-existing glued-marker bug where "Tempest GX【衣】"/"Welkin GX【衣】" rows (no space before "GX")
were silently misclassified into plain 縁 instead of 縁GX, already reflected in the counts below.

**Update (2026-10-20, plain Exotic corrected to Pre-G-Rank):** only the plain 縁 (Exotic) row below
turned out to be Pre-G-Rank, not G-Rank, per the project owner's own reference taxonomy -- despite
being `CLASS O` alongside the genuinely G-Rank G祕/始/etc. leaves above. Its G/GF/GX tiers (縁G/縁GF/
縁GX) stayed G-Rank. Only the `grank_exotic` (plain) UI leaf moved out of this "G Rank Armor" group,
into a new "Exotic" section under "Standard Armor" (see that section below); `grank_exotic_g`/`_gf`/
`_gx` stayed in "G Rank Armor", in their own "Exotic" section there. Gachapon's own "Gachapon Exotic"
leaves (a separate group, under "Paid and Premium" below) are unrelated and untouched -- still all
Pre-G-Rank as before. This is purely a "Gear levels" UI-tier correction -- `is_grank_or_later_equipment`
in gear_category.py (the real in-game active-skill-cap G-Rank piece-count bonus) still treats
`CLASS O` as G-Rank-or-later, which is a separate, unrelated mechanic and was intentionally left
untouched.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| G | `CRE=1-` + `CLASS I` + "G" | 969 | HIGH |
| GF | `CRE=1-` + `CLASS I` + "GF" | 969 | HIGH |
| GX | `CRE=1-` + `CLASS I` + GX, excluding Mystery Quest Armour ("Luxt" series, see "Event Armour" below) | 959 | HIGH |
| G覇 (G Supremacy) | `CLASS G` | 270 | HIGH — same kanji ("覇") as `CLASS D`'s "Supremacy" below, just the G-rank tier; label corrected 2026-10-18 from the un-translated "G-Hashu" for consistency |
| ? (CLASS H / 烈種, label unconfirmed) | `CLASS H` | 270 | **Label needs your confirmation** — I don't actually know the reference tool's name for this leaf; "刻祕" (my earlier guess) doesn't fit the kanji and was never verified, same mistake pattern as "皇GX" turned out to be. The CLASS→270-row match itself is solid; only the display label is in question. |
| G祕 | `CLASS L` + "G" | 280 | HIGH |
| G祕GF | `CLASS L` + "GF" | 280 | HIGH |
| G祕GX | `CLASS L` + "GX" | 280 | HIGH |
| 始 (Sisyu/Origin) | `CLASS M` | 200 | HIGH |
| 縁 (Exotic) | `CLASS O`, no suffix | 110 | HIGH |
| 縁G | `CLASS O` + "G" | 110 | HIGH |
| 縁GF | `CLASS O` + "GF" | 110 | HIGH |
| 縁GX | `CLASS O` + GX | 110 | HIGH |

### Zenith Armour

**Update (2026-10-18):** the "辿" (plain Zenith) leaf itself splits exactly 50/50 by a "ZF" vs. bare
"Z" name-suffix token -- the same pattern as the existing ZX/ZY checks, just two more token values to
add alongside them (confirmed against the real dataset: every remaining non-ZF row carries a literal
"Z" token, not the absence of one).

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 辿 (Zenith) | `CRE=1-` + `CLASS P`, "Z" token | 230 | HIGH |
| 辿ZF (Zenith ZF) | `CRE=1-` + `CLASS P` + ZF | 230 | HIGH |
| 辿ZY | `CRE=1-` + `CLASS P` + ZY | 230 | HIGH |
| 辿ZX | `CRE=1-` + `CLASS P` + ZX | 230 | HIGH |

**Note:** the identical Z/ZF/ZY/ZX 4-way split also exists in Road Zenith (`CRE=1t`, 60/60/60/60) and
Event Zenith (`CRE=1e`, 52/52/52/52), and even within Diva Defense's own `CRE=2u` bucket (100/100/100/
100) -- none of these were split, since the project owner's request was scoped to the "Zenith Armour"
group specifically. Flagged here in case the same split is wanted for those other groups later.

### Hardcore Quests
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| LX | `CRE=1-`, plain class, LX suffix | 60 | HIGH |
| RX | `CRE=1-`, RX suffix | 50 | HIGH |
| HC | `CLASS E` | 312 | HIGH |
| HS | `CLASS F` | 214 | HIGH |
| 天 (Heavenly Storm) | `CLASS C` | 270 | HIGH |
| 覇 (Supremacy) | `CLASS D` | 270 | HIGH |
| 祕 (Hiden) | `CLASS K`, no "F" | 280 | HIGH |
| 祕F (Hiden F) | `CLASS K` + "F" | 140 | HIGH — 2026-10-20: Hiden only has an "F" tier, no FZ/FY, unlike the plain `CLASS ""` buckets elsewhere in this taxonomy |

### HR100~
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| FX | plain class + FX suffix, `CRE` in {1-, 1e} | 242 | HIGH — `CRE=2m`'s 40 FX rows moved to Festival FX (2026-10-20, see "Guild" above) |
| 凱 (Gou) | `CLASS B` | 260 | INFERRED (270/270 match ≪剛種防具≫; glyph is 凱, not 剛) |

### Event Armour (イ)
**Update (2026-10-18)**: per the project owner's redone schema (docs/skill-system-roadmap.md TODO
#38), this bucket now splits by GX tier (previously one flat leaf for both, confirmed HIGH against
the real dataset but not matching the reference tool's own tree, which does split it) and has Musou
and Extreme Quest armor carved out of it by curated name, the same way decorations already carve
Musou out of their own Event bucket. No separate "Event G" leaf exists (G/GF-tier non-curated rows
stay in the plain bucket, matching the reference tool's own 2-leaf "イ/イGX" shape, not decorations'
3-leaf one).
**Update (2026-10-20):** the 2026-10-20 GS/GP audit found this bucket's `CLASS J` (G-Shugo) rows had
no branch at all -- they were silently falling into the plain イ leaf below, undercounted there rather
than genuinely absent. Split into new イGS/イGP leaves (the イ count below is corrected to exclude
them). The matching 衛GP (Hunting Tournament) leaf had the opposite bug -- it existed, but was
hardcoded to always return GP, mislabeling half its rows; split into 衛GS/衛GP below.

**Update (2026-10-20, F/FZ and G/GF split):** イ's own plain remainder splits further by F/FZ, and 衛's
own plain remainder and G-rank leaf split further by F/FZ and G/GF respectively (see the taxonomy-wide
note above) -- **but unlike every other route in this taxonomy, イ's own G/GF stays merged** (not
split into separate leaves). This is a confirmed, intentional exception: the project owner's own
screenshot of the reference tool's actual Event tree shows a 2-leaf "イ/イGX" shape (not the 3-leaf
"G"/"GF"/"GX" shape decorations use for the matching `deco_event_g`/`deco_event_gx` pair) -- so a
G-tier, non-GX, non-curated-name Event row stays in the plain イ leaf regardless of whether its own
name carries "G" or "GF".

**Update (2026-10-20, further distinctions):** inspecting イ's own CLASS breakdown for more structure
(prompted by the project owner, same way the GS/GP gap was originally found) turned up two more issues,
both now fixed:
- `CLASS` F/E/A (HS/HC/SP) had no branch at all under `CRE=1e` -- same bug shape as the GS/GP one
  above -- 255/91/3 real rows were silently falling into plain イ instead of their own イHS/イHC/イSP
  leaves, undercounted there rather than genuinely absent. Every other acquisition route in this
  taxonomy already splits out its own HS/HC/SP tier; Event was the one exception, not by any confirmed
  design, just a gap.
- イGX's own `"GX" in tokens` check used plain whitespace-token membership, missing 29 rows with "GX"
  glued directly onto following kana/kanji/bracket text with no separating space (e.g.
  "若Crimson葉GX【角】", "Youthclad ノ肩鎧GX", "Shirukku GXグローブ") -- the same glued-marker bug
  shape already fixed elsewhere in this taxonomy (道GX, 航GX, 縁GX). Switched to the regex-based
  `_has_marker` check those fixes already use; the GX count below is corrected to include them (was
  undercounted by exactly 29 in the prior pass of this doc).
- The remaining イ (plain) `CLASS I` rows with no G/GF/GX marker at all (30 real rows, e.g. "ハーデス
  Head"/"コルヌー Mail") are a legitimate edge case, not a further gap -- bare G-rank-class item names
  with no tier suffix at all, the same "CLASS alone, no marker to key on" situation several other
  leaves in this taxonomy already fall back to.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| イ | `CRE=1e`, no suffix, excluding Zenith/FX/Mystery/Musou/Extreme/G-Shugo/HS/HC/SP | 585 | HIGH |
| イF | `CRE=1e`, plain `CLASS` + "F" | 434 | HIGH |
| イFZ | `CRE=1e`, plain `CLASS` + "FZ"/"FY" | 301 | HIGH |
| イHS | `CRE=1e` + `CLASS F` | 255 | HIGH |
| イHC | `CRE=1e` + `CLASS E` | 91 | HIGH |
| イSP | `CRE=1e` + `CLASS A` | 3 | HIGH |
| イ (G/GF, merged) | `CRE=1e` + `CLASS I`, no GX marker, excluding Musou/Extreme | 664 | HIGH — deliberately merged into the イ leaf above, not split (see note above); counted separately here for traceability. 634 of these carry a "G"/"GF" marker, the other 30 carry no marker at all (see note above) |
| イGS | `CRE=1e` + `CLASS J` + "GS" | 40 | HIGH |
| イGP | `CRE=1e` + `CLASS J` + "GP" | 40 | HIGH |
| イGX | `CRE=1e` + `CLASS I` + GX, excluding Musou/Extreme | 317 | HIGH |
| イ辿 | `CRE=1e` + `CLASS P` | 104 | HIGH |
| イ辿ZY | `CRE=1e` + `CLASS P` + ZY | 52 | HIGH |
| イ辿ZX | `CRE=1e` + `CLASS P` + ZX | 52 | HIGH |
| 謎 (Mystery Quest Armour) | `Luxt` series, GX tier, all 5 slots × all TYPE variants | 10 | CONFIRMED — **fixed 2026-10-20**: this check used to be miswired into the `cre == "1e"` branch under the assumption its rows used `CRE=1e`; the real rows are a full standard-tier set (plain/F/FY/HS/G/GF/GX) at `CRE=1-`+`CLASS I`, same as any other G-rank armor, so the 10 real rows were silently landing in `grank_gx` instead (the "GX" row above is now corrected to exclude them). Only Luxt's own GX tier is carved out this way — its G/GF tiers stay in the ordinary `grank_g`/`grank_gf` leaves. |
| 衛 (Hunting Tournament) | `CRE=1i`, no suffix | 16 | HIGH |
| 衛F | `CRE=1i`, plain `CLASS` + "F" | 13 | HIGH |
| 衛FZ | `CRE=1i`, plain `CLASS` + "FZ"/"FY" | 13 | HIGH |
| 衛HC | `CRE=1i` + `CLASS E` | 10 | HIGH |
| 衛HS | `CRE=1i` + `CLASS F` | 13 | HIGH |
| 衛G | `CRE=1i` + "G" | 10 | HIGH |
| 衛GF | `CRE=1i` + "GF" | 10 | HIGH |
| 衛GX | `CRE=1i` + GX | 10 | HIGH |
| 衛GS | `CRE=1i` + `CLASS J` + "GS" | 3 | HIGH |
| 衛GP | `CRE=1i` + `CLASS J` + "GP" | 3 | HIGH |
| 衛ZP | `CRE=1i` + `CLASS Q` | 3 | HIGH |

### Musou Armour (CRE=1e + CLASS=I, carved out of Event Armour by name)
Confirmed by the project owner (2026-10-18) against the real armor names for all 9 Musou-tier
monsters -- CRE/CLASS alone can't distinguish these from any other Event-GX armor, same situation the
matching Musou *decorations* were already in. Unlike the decorations (which use a distinct "<name>
GX1".."GX5" naming scheme per monster and always share one leaf across both hunter-type names), Musou
ARMOR only has a genuine two-name split for 2 of the 9 monsters; the armor name itself also differs
from the decoration name for 3 monsters (Bogabadorumu/Zerureusu/Elzelion: Rapin/Elysi/Fonse here vs.
Rafan/Elysium/Fonce for the matching decoration).

**Update (2026-10-20): split by G/GF/GX tier instead of by monster.** The project owner asked for this
("split musou by level instead of source") once the 2026-10-20 audit confirmed all 9 monster sets
independently carry all 3 tiers. The monster/quest name itself is still visible in each item's own
name -- it's just no longer a separate category branch, so there are 3 leaves total instead of 9.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| `event_musou_g` | `CRE=1e` + `CLASS I`, name starts one of the 9 Musou monster names above, "G" tier | 85 | CONFIRMED |
| `event_musou_gf` | same, "GF" tier | 85 | CONFIRMED |
| `event_musou_gx` | same, "GX" tier | 85 | CONFIRMED |

### Extreme Quest Armour (CRE=1e + CLASS=I, carved out of Event Armour by name)
Confirmed by the project owner (2026-10-18): 4 distinct quest rewards, none tied to an actual Musou
monster (the reference tool's own tree calls this "EXd"/Extreme Quests, previously deferred for
decorations -- see docs/skill-system-roadmap.md TODO #38/#39 history). Demon Lord/童子ノ is a full
5-slot set (2 hunter-type-flavored names); Heruto/Iroasu/Luchar are head-slot-only with no other-slot
counterpart.

**Update (2026-10-20): split by G/GF/GX tier instead of by quest**, same as Musou above.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| `event_extreme_g` | `CRE=1e` + `CLASS I`, name starts one of the 4 Extreme Quest names above, "G" tier | 13 | CONFIRMED |
| `event_extreme_gf` | same, "GF" tier | 13 | CONFIRMED |
| `event_extreme_gx` | same, "GX" tier | 13 | CONFIRMED |

**Correction (2026-10-18)**: Raviente-named armor was initially suspected to exist inside `grank_gx`
("Violent Ravi"/"Berserk Ravi"/"Extreme Ravi" BM/GN GX1-GX5) -- re-verified by tracking which
`SkillForm.setEquip("<slot>", ...)` section each row actually lives in, and all of those rows are in
the `"deco"` section, not real armor. They're the already-fully-implemented Raviente *decorations*
(`deco_raviente`/`deco_extreme_raviente` below) -- no Raviente armor exists at all, `grank_gx` was
never actually affected.

### Standard Armour

**Update (2026-10-20):** splits further into F/FZ (see the taxonomy-wide note above).

**Update (2026-10-20, plain Exotic moved in):** only the plain 縁 (Exotic) leaf (`grank_exotic`) moved
here from "G Rank Armor" above, as its own UI "Exotic" section -- see that section's own note for why
(confirmed Pre-G-Rank, not G-Rank, despite `CLASS O`). Its G/GF/GX tiers (`grank_exotic_g`/`_gf`/`_gx`)
stayed in "G Rank Armor"'s own "Exotic" section. The rule/count/confidence for the plain leaf is
unchanged from the "G Rank Armour" table above; only its UI grouping moved.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 無分類 | `CRE=1-`, plain class, no suffix | 2,641 | HIGH |
| 無分類F | `CRE=1-`, plain class + "F" | 363 | HIGH |
| 無分類FZ | `CRE=1-`, plain class + "FZ"/"FY" | 110 | HIGH |
| SP | `CLASS A` | 881 | HIGH |

### Unavailable

**Update (2026-10-20):** these 2 leaves are still produced by the ETL (neither category disappeared
from the underlying data or `classify_equipment_category`), but per the project owner they're no
longer one of the UI's togglable gear-category groups -- neither is a real, obtainable item, so both
are now excluded from the general search pool unconditionally
(`build-query.ts`'s `_UNOBTAINABLE_EQUIPMENT_CATEGORIES`), the same convention the matching
decoration leaves (`deco_training_only`/`deco_unimplemented`/`deco_impossible_to_create`) already use.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 未 | `CRE=9` | 346 | HIGH |
| 不 | `CRE=7-` | 120 | HIGH |

**Curated name lookups needed in the ETL** (field combination alone can't distinguish these):
- EXa / PostZ / PreZ named-series groups (already resolved in an earlier pass).
- 刻GX vs 塔GX were originally thought to need a split by name — they don't; both are one leaf (刻GX), see above.
- 謎: `Luxt` series name, GX tier only.

## Tree 2: Decorations and Cuffs (`DEC="1"` = cuff, `DEC=""` = deco)

**Cuffs half implemented (2026-10-14)**: `etl/src/etl/parse/gear_category.py`'s
`classify_cuff_category` implements every leaf in "Premium Outfit Pugi
Cuffs"/"Standard Pugi Cuffs" below, threaded through `Cuff.category` ->
`cuffs.json`'s `category` field (see the skill-system-roadmap's cuff-support
TODO). Every leaf's count was re-verified by re-running the full ETL
pipeline against the live cached dataset and tabulating `cuff.category` --
all 18 leaves matched this table's counts exactly (3,332 cuffs total at the
time), so every "INFERRED" tag below should be read as re-confirmed, not
just originally plausible.

**Update (2026-10-15)**: the "S_辿 (Zenith)" leaf's count above was
corrected from 52 to 26 -- the 26 `DEC=3`+`CLASS P` "Sigil" rows it used to
include turned out not to be Cuffs at all (see docs/data-format-notes.md
"Cuffs"), dropping the real total to 3,306.
Display labels for cuff leaves still haven't been confirmed against the
reference tool's own tree (unlike every equipment leaf above) -- the
`cuff_*` category keys are correct and already usable for filtering, but
treat their eventual UI label as open.

**Decorations fully implemented (2026-10-15)**: `classify_decoration_category`
in `etl/src/etl/parse/gear_category.py` implements every confirmed leaf below,
threaded through `Decoration.category` -> `decorations.json`'s `category`
field. Re-verified by re-running the full ETL pipeline against the real
cached dataset and tabulating `decoration.category`: every leaf below matched
its confirmed count exactly (2,658 decorations total). CRE/CLASS alone was
enough for every leaf except the 5 "Musou" leaves and Keoaruboru, which the
project owner confirmed by name against the real dataset (see "Musou
Decorations" and "Keoaruboru" notes below) -- CRE/CLASS can't distinguish
these from any other named monster's ordinary G-rank decorations. One known
gap: "(EXd): Extreme Quests" from the reference tool's own tree couldn't be
confirmed against any real decoration name and is deferred (see
docs/skill-system-roadmap.md). Tower Gems (`CLASS=N`) get their own leaf
(`deco_tower`) purely for traceability -- they're governed by the
pre-existing, separate `isTower` flag, not surfaced as a selectable option in
this tree.

### Premium Outfit Pugi Cuffs

**Update (2026-10-20):** `P_未` (`cuff_premium_unavailable`) is still produced
by the ETL, but per the project owner it's not a real, obtainable item, so
it's no longer a togglable UI leaf at all -- it's now excluded from the
general search pool unconditionally (`build-query.ts`'s
`_UNOBTAINABLE_CUFF_CATEGORIES`), the same convention the equipment-side
"### Unavailable" categories and the decoration table's Lottery Hiden row
(below) use. Previously it was a default-excluded-but-togglable leaf.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| P | `CRE=4k` + recipe materials 09E5/6/7 | 384 | INFERRED |
| P_II | `CRE=4k` + recipe 110C/D/E | 576 | HIGH |
| P_G | `CRE=4k` + recipe 208A/B/C | 720 | INFERRED |
| P_ネ | `CRE=3e` | 26 | HIGH |
| P_イ | `CRE=1e` | 19 | HIGH |
| P_特 | `CRE=5-` | 13 | HIGH |
| P_辿 | `CRE=4g` + `CLASS P` | 250 | HIGH |
| P_未 | `CRE=9` + P name | 37 | HIGH |
| P_不 | *(no leaf — confirmed empty)* | 0 | CONFIRMED |
| 穴 (Premium Kit) | *(no leaf — confirmed empty)* | 0 | CONFIRMED |

### Standard Pugi Cuffs

**Update (2026-10-20):** `S_未` (`cuff_standard_unavailable`) and `S_不`
(`cuff_standard_training_only`) get the identical unconditional-exclusion
treatment as `P_未` above, for the same reason (confirmed not real/obtainable
items) -- also via `_UNOBTAINABLE_CUFF_CATEGORIES`.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| S | `CRE=1-`, HR < 2001 | 193 | HIGH |
| S_G | `CRE=1-`, HR ≥ 2001 | 154 | INFERRED |
| S_イ | `CRE=1e` | 110 | HIGH |
| S_謎 (Mystery Cuff) | `CRE=1i` | 344 | CONFIRMED — matched against your curated skill-name list (Ammo Combiner, Anti-Theft II, Auto-Guard, Backpacking, Bomb Boost II, Breakout, Capture Expert, Cold Res, Combining, Defense II, Dragon Attack, Dragon Sword, Eating, Everlasting, Fishing, Gathering Spd, Gluttony II, Gunnery, Health, Heat Res, Ice Res, Inspiration, Paralysis Res, Pellet Shot, Pressure, Recovery Speed, Sleep Coating, Sleep Res, Strong Arm, Thunder Res, Wide-Area — each across its SA/SB/SC tier variants) |
| S_猟 (Guild) | `CRE=2-`, no sub-split between the two recipe-material families | 153 | CONFIRMED — "don't make a distinction between them" |
| S_祭 (Festival) | `CRE=2m` | 104 | HIGH |
| S_辿 (Zenith) | `CRE=1-` + `CLASS P` "SZ", `DEC=1` only | 26 | HIGH — the matching `DEC=3`+`CLASS P` "Sigil" rows are Weapon Sigils, not Cuffs (see docs/data-format-notes.md "Cuffs") |
| S_未 | `CRE=9` + S name | 45 | HIGH |
| S_不 | `CRE=7-` ("Guild R. Cuff") | 12 | INFERRED |
| 祕 (Hiden Cuff) | `CRE=1-` + `CLASS L` | 140 | HIGH |

### Decorations

**Status (2026-10-18): reworked to match the reference tool's own decoration
tree screenshot the project owner supplied.** Leaf keys below are
`classify_decoration_category`'s actual return values (`deco_*`), not the
reference tool's own display codes (shown in the "Leaf" column for
cross-reference, same as every table above). Every count was re-verified
against the real, properly-filtered dataset (2,658 decorations; `DEC==""`
rows only -- earlier passes that didn't filter out Cuff/placeholder rows got
some counts wrong, since cuffs and decorations share the same raw "deco" JS
bucket, see docs/data-format-notes.md "Cuffs").

| Leaf | Key | Rule | Count | Confidence |
|---|---|---|---|---|
| 無分類 | `deco_standard` | `CRE=1-`, plain | 271 | HIGH |
| SP | `deco_sp` | `CRE=1-` + `CLASS A`, name ends plain "SP" | 43 | CONFIRMED — see "SP Decorations" note below |
| SP改 (SP Lv2) | `deco_sp_lv2` | `CRE=1-` + `CLASS A`, name ends "SP α" | 43 | CONFIRMED |
| SP真 (SP Lv3) | `deco_sp_lv3` | `CRE=1-` + `CLASS A`, name ends "SP β" | 43 | CONFIRMED |
| G | `deco_g` | `CRE=1-` + `CLASS I` + G/GF (incl. numbered `G2`.."G5"/`GF2`.."GF5" tier variants) | 360 | HIGH |
| GX | `deco_gx` | `CRE=1-` + `CLASS I` + GX | 842 | HIGH |
| G祕 (Hiden) | `deco_hiden` | `CRE=1-` + `CLASS L` "Hiden?" | 56 | HIGH |
| 真G祕 (True Hiden) | `deco_true_hiden` | `CRE=1-` + `CLASS L` "True?" | 56 | HIGH |
| 蛇GX (Raviente Decorations) | `deco_raviente` | `CRE=1-` + `CLASS I`, name starts "Raviente"/"Violent Ravi"/"Berserk Ravi" | 30 | CONFIRMED |
| 極蛇GX (Extreme Raviente Decorations) | `deco_extreme_raviente` | `CRE=1-` + `CLASS I`, name starts "Extreme Ravi" | 10 | CONFIRMED |
| DClad (Musou Nargacuga) | `deco_musou_nargacuga` | `CRE=1e` + `CLASS I`, name starts "Demonclad" (BM) or "Dojiclad" (GN) | 10 | CONFIRMED — user-provided names |
| Rapin (Musou Bogabadorumu) | `deco_musou_bogabadorumu` | `CRE=1e` + `CLASS I`, name starts "Rafan" | 10 | CONFIRMED — user-provided name |
| Elysium (Musou Zerureusu) | `deco_musou_zerureusu` | `CRE=1e` + `CLASS I`, name starts "Elysium" | 10 | CONFIRMED — user-provided name |
| Bonne (Musou Duremudira) | `deco_musou_duremudira` | `CRE=1e` + `CLASS I`, name starts "Bonne" | 10 | CONFIRMED — user-provided name |
| Fonce (Musou Elzelion) | `deco_musou_elzelion` | `CRE=1e` + `CLASS I`, name starts "Fonce" | 10 | CONFIRMED — user-provided name |
| Heruto (Extreme Quest) | `deco_extreme_heruto` | `CRE=1e` + `CLASS I`, name starts "Heruto" | 1 | CONFIRMED — user-provided name |
| Iroasu (Extreme Quest) | `deco_extreme_iroasu` | `CRE=1e` + `CLASS I`, name starts "Iroasu" | 1 | CONFIRMED — user-provided name |
| Luchar (Extreme Quest) | `deco_extreme_luchar` | `CRE=1e` + `CLASS I`, name starts "Luchar" | 3 | CONFIRMED — user-provided name |
| イ (Event) | `deco_event` | `CRE=1e`, plain class | 49 | HIGH |
| イG | `deco_event_g` | `CRE=1e` + `CLASS I` + G/GF, not a Musou/Extreme Quest name | 4 | HIGH |
| イGX | `deco_event_gx` | `CRE=1e` + `CLASS I` + GX, not a Musou/Extreme Quest name | 40 | HIGH — includes "Reiresu"/"Reuasu"/"Riaruo" (plain, numbered-tier event-GX names explicitly ruled out as Musou by the project owner) and "Jess" (G/GF/GX1-5) |
| 祭G (Festival) | `deco_festival_g` | `CRE=2m` + `CLASS I` + G/GF | 106 | HIGH |
| 祭GX (Festival GX) | `deco_festival_gx` | `CRE=2m` + `CLASS I` + GX | 315 | HIGH |
| 猟G (Guild) | `deco_guild_g` | `CRE=2-` + `CLASS I` + G/GF | 8 | HIGH |
| 猟GX (Guild GX) | `deco_guild_gx` | `CRE=2-` + `CLASS I` + GX | 20 | HIGH |
| 衛GX (Diva Defense) | `deco_keoaruboru` | `CRE=2u` | 10 | CONFIRMED — user-provided names "Burning Cliff"(BM)/"Crimson Cliff"(GN); obtained through Diva Defense, so this is also the reference tool's "Diva Def" leaf (one and the same, not two leaves) |
| 道 (Road) | `deco_road` | `CRE=1t`, plain | 3 | HIGH |
| Wht (Wht Fatalis) | `deco_road_white_fatalis` | `CRE=1t` + `CLASS I`, name starts "Wht Fatalis" | 10 | CONFIRMED |
| 道GX (Multi Event) | `deco_road_gx` | `CRE=1t` + `CLASS I`, not Wht Fatalis | 30 | HIGH |
| ガG祕 (Lottery Hiden, "do not use") | `deco_lottery_hiden` | `CRE=4g` + `CLASS L` "Hiden EX" | 56 | HIGH — **Update (2026-10-20):** per the reference tool's own "do not use" labeling, folded into `_UNOBTAINABLE_DECORATION_CATEGORIES` (not a togglable leaf anymore; was previously default-excluded-but-togglable) |
| 特 (Special) | `deco_special` | `CRE` 4k or 5-, "kit purchase" RECIPE1 text | 5 | CONFIRMED label is a judgment call, not project-owner-confirmed — see note below |
| カ (Training) | `deco_training_only` | `CRE=7-` | 12 | HIGH |
| 未 (Unimplemented) | `deco_unimplemented` | `CRE=9`, no "作成不可" RECIPE1 marker (typically HR1 sentinel "10000") | 5 | INFERRED |
| 不 (Impossible to Create) | `deco_impossible_to_create` | `CRE=9`, RECIPE1 literally "作成不可" | 3 | HIGH |
| (unsurfaced) Tower Gem | `deco_tower` | `CRE=1t` + `CLASS N` | 173 | HIGH — not a selectable leaf in this tree; governed by the separate `isTower` flag |
| (unsurfaced) everything else | `deco_other` | anything unmodeled (none found in the real dataset as of 2026-10-18) | 0 | n/a |

**SP Decorations (2026-10-18):** confirmed by the project owner to be usable
only in SP armor, the identical restriction (and identical plumbing
mechanism) Tower Gems already get -- a new `isSp` flag (mirroring `isTower`)
excludes every SP decoration from the general search pool unconditionally
(`build-query.ts`'s `decorationsAfterCategoryFilter`), with the same
one-sided-enforcement caveat documented for Tower in
docs/skill-system-roadmap.md TODO #11. The 3 tiers (SP/SP改/SP真) are
distinguished by a literal name-suffix convention found in the real data:
plain `"<Skill> SP"`, then `"<Skill> SP α"`, then `"<Skill> SP β"` -- these are
a recipe *chain* (α's own recipe references the base SP item, β's references
α), not arbitrary kanji suffixes.

**Extreme Quest Decorations (2026-10-18):** only 3 of the 4 Extreme Quest
armor sets have a confirmed decoration ("Demon Lord"/童子ノ has none, 0 real
rows). The project owner initially estimated Heruto/Iroasu/Luchar at
1/2/3 decorations respectively; the real data confirms Heruto=1, Luchar=3
(G/GF/GX tiers), but Iroasu has only 1 (GX only, no G/GF tiers found) --
flagged as a minor discrepancy, not independently resolved.

**Musou Decorations:** still only 5 of the 9 Musou monsters (Nargacuga,
Bogabadorumu, Zerureusu, Duremudira, Elzelion) -- the project owner
explicitly confirmed this is not a gap: "Reiresu, Reuasu, Riaruo are
different ones. its only the 5." (2026-10-18), ruling out 3 other
same-shaped curated names (`<name> BM/GN GX1`-`GX5`, same `CRE=1e`+`CLASS I`
bucket) found during research as Musou candidates -- they're plain
`deco_event_gx` instead.

**"(パ) Package" and "(ガTW) Lottery Decorations"** (its own "TW Decorations"
top-level node in the reference tree) are both confirmed empty -- 0 real
decoration rows under any CRE code checked (`5p`, `3-`, `3e`) -- same
no-leaf-at-all convention as Taiwanese Premium armor. **"(塔GX) Event Cycle
Decorations"** (nested under Events, separate from Hunter's Road) has no
distinguishing CLASS of its own in the real `CRE=1t` data either -- its
bucket is already fully and correctly accounted for by
`deco_road`/`deco_road_white_fatalis`/`deco_road_gx` above, so it's treated as
unpopulated in this dataset rather than reassigning anything.

**"(特)" label is an unconfirmed judgment call,** not a project-owner
confirmation (flagged the same way `CATEGORY_GRANK_BURST_SPECIES`'s label
is): the only real decoration rows left among the lottery/paid CRE codes,
once Cuffs are excluded, are these 5 "kit purchase" rows (RECIPE1 text
literally names an anniversary/premium kit purchase in Japanese) -- the best
real-data fit for "(特)", since "(パ) Package" has zero real rows to compare
against.

## TYPE field (not yet parsed — to add regardless of this taxonomy)

Column 2 of each row (`docs/data-format-notes.md:45`): `0`=Common,
`1`=Blademaster, `2`=Gunner. Currently unread by `equipment.py`'s `Field`
enum. Reliable and general — confirmed to resolve every Blademaster/Gunner
naming-duality case encountered while building this taxonomy (Tower armor,
Luxt/Mystery armor), with no exceptions found. Doesn't affect which
category leaf a row belongs to (every TYPE variant of an item stays
together), but is worth exporting as its own field since it's a natural,
reliable filter dimension on its own (e.g. "only show gear my weapon class
can wear").

## Remaining open items

1. **刻 (Customisable Tower, non-GX)** — no armor rows match `CRE=1t` +
   `CLASS N` without a GX/HS/G suffix beyond the already-assigned 塔 family.
   Presumed weapons-only; flag if you have a counter-example.
2. **The CLASS H (烈種) leaf's display label** — the 270-row match is solid,
   but I don't have a confirmed name for it from your tree (see table above).
