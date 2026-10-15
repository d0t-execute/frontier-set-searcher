# Source data format notes

Reverse-engineered from the site's own client-side code
(`skill/SkillForm.js`, `skill/equip.js`) rather than guessed — that script is
what renders the skill simulator from this exact data, so it's ground truth.
This is the spec the Phase 2 parser fixtures/tests are built against.

## How the data is embedded

`skill/equip.js` is a ~11MB script of calls like:

```js
SkillForm.setEquip("head", {
"0001":"Leather Helm,0,0,1,,0,0,0,0,0,22,3,63,3,80,3,,,,,,01521R,1,0000,7,100,2,0,1,01,00,0B,0,1-,,,,,軽い素材で作られた頭用装備。使い手を選ばない堅実な作りが安心。,0"
,"0002":"..."
})
```

Buckets seen: `head`, `body`, `arm`, `wst`, `leg`, `deco` (armor pieces +
decorations, ~12,000 each), `sozai` (materials), `jpg` (image refs), `zeny`,
`def`, `slot` (percentage/offset pattern tables — see below). Only
`head`/`body`/`arm`/`wst`/`leg`/`deco` and `def` are in scope for this
project (skills + slots + rarity + level are what the search needs; crafting
materials/zenny/images are not).

**Extraction**: find `SkillForm.setEquip("<bucket>"`, then scan forward for
the first `{` or `[` and take the balanced (bracket-depth-aware, string-aware)
substring up to its match. That substring is valid JSON as-is — no JS parser
needed, just `json.loads()`. Verified against all buckets directly in the
browser console. The per-item *value* is then a single comma-delimited
string, split again to get the positional fields below (this mirrors the
site's own `setEquipSplit()`, which does exactly `value.split(",")`).

Field count varies per row — trailing empty fields are sometimes omitted
entirely in the source (e.g. a decoration row may have only 36 of the 40
fields). Treat missing trailing fields as empty/`None`, don't assume a fixed
length.

## Column layout (from `SkillForm.js`'s `I_b*` constants)

| # | Field | Meaning |
|---|---|---|
| 0 | NAME | Item name |
| 1 | SEX | 0=All, 1=Male, 2=Female |
| 2 | TYPE | 0=Common, 1=Blademaster, 2=Gunner -- parsed as `hunter_type`/`hunterType` (docs/skill-system-roadmap.md TODO #17): Blademaster- and Gunner-restricted armor can't be mixed in one build, enforced as a pre-solve filter |
| 3 | RARE | Rarity |
| 4 | GR | G-Rank tier marker |
| 5–9 | F, W, T, D, I | Fire/Water/Thunder/Dragon/Ice resistance |
| 10–19 | SN1/SP1 … SN5/SP5 | Skill ID + points, up to 5 skills |
| 20 | UPGBACK | Upgrade-back reference |
| 21 | RECIPE1 | Crafting recipe (materials) |
| 22 | **HR1** | **Hunter Rank requirement** — used directly as a `<=`/`>=` filter in the site's own search (confirmed from its code), i.e. exactly the "available at this level" field the project needs |
| 23 | LVUPPTN | Upgrade-level pattern ref. Non-empty ⇒ equipment (has forge levels); empty ⇒ decoration |
| 24 | LVMAX | Number of forge levels (e.g. 7) |
| 25 | ZENY | Base forge cost (out of scope) |
| 26 | DEF | Base defense (at forge level 0) |
| 27 | SLOT1 | Base decoration-slot count |
| 28 | SLOT7 | Max decoration-slot count (equipment) **or the decoration's own slot size** (decorations) |
| 29 | ZENYPTN | Cost-scaling pattern ref (out of scope) |
| 30 | DEFPTN | Defense-scaling pattern ref — index into the `def` bucket |
| 31 | SLOTPTN | Slot-scaling pattern ref (out of scope — SLOT1/SLOT7 already give us base/max) |
| 32 | UPGCNT | Crafting metadata (out of scope) |
| 33 | **CRE** | Acquisition-method code, e.g. `"4k"` — two sub-codes looked up in `MAKENAME` (see "Acquisition method" below). Not modeled yet. |
| 34 | **DEC** | **Equipment category signifier #1** — see "Equipment taxonomy" below. `""` = armor decoration (or normal armor), `"1"` = Cuff, `"2"` = Tower Armor Sigil, `"3"` = Tower Weapon Sigil |
| 35 | **CLASS** | **Equipment category signifier #2** — origin/rarity tier (full table in "Equipment taxonomy"). Distinguishes e.g. a Hiden Cuff (`"L"`) from a regular one, and Tower (`"N"`) / Zenith (`"P"`/`"Q"`) equipment from normal gear |
| 36 | TrSLOT | Out of scope |
| 37 | **Teni** | **Zenith skill** carried by `CLASS="P"`/`"Q"` equipment (armor or Cuff) — an *additional* skill beyond SN1–5, resolved through a third lookup array, `TENINAME`, not `MST_Skill`. See "Equipment taxonomy" |
| 38 | DOC | Flavor text — often names the category outright, e.g. `≪天廊防具≫` ("Tower Armor") or `≪辿異防具≫` ("Zenith Armor"). **Exotic equipment** (`CLASS="O"`) additionally embeds a bracketed bonus-skill marker here, `≪Exotic Armor：<skill tier label>≫` — see "Exotic armor" below |
| 39 | IMG | Image reference (out of scope) |

**Important**: skill points (SP1–SP5) are fixed per piece — they do **not**
scale with forge level. Only defense and slot count change across levels
(confirmed from `SkillForm.js`'s `dispData`, which reads `eq[I_bSP1]` etc.
directly with no level adjustment, vs. `getDef`/`getSlot` which explicitly
loop over levels). This matters: it means our Phase 1 `EquipmentSkill.points`
schema (a single fixed value) is correct as-is — no rework needed.

## Defense progression (the `def` bucket)

`getDef(eq)` in `SkillForm.js`:

```js
if (eq[I_bLVUPPTN]) {              // equipment (has levels)
    var def = +eq[I_bDEF], ptn = MST_Equip.def[parseInt(eq[I_bDEFPTN], 16)].split(",");
    var list = [def];
    for (var i = 1; i < 7; i++) {
        def = (def * ptn[i] / 100 | 0) + (/* +1 rounding edge case, see source */ 0 or 1);
        list[i] = def;
    }
    return list;                   // defense at each forge level, 0..6
} else {
    return ["", "", "", "", "", "", ""];   // decoration: no progression
}
```

`def[n]` entries are comma strings of 7 percentages, e.g. `"100,120,120,120,120,120,120"`
— applied multiplicatively level over level. We only need **base** (`DEF`
directly) and **max reachable** (the list entry at index `LVMAX - 1`) for the
search engine; the full per-level table isn't needed for "best possible
build" queries, so we compute and store just those two.

Slots don't need this treatment: `SLOT1` (base) and `SLOT7` (max) are both
given directly on the row — no pattern lookup needed for base/max, only for
the intermediate per-level values, which we don't need.

## Duplicate skill IDs on one row

A handful of rows (5 out of ~62,000 armor pieces, all found while running the
real pipeline) list the **same skill ID in more than one SN/SP slot** — e.g.
`arm:1DF3` ("Endre F Guard") has `SN3=143,SP3=3` and `SN5=143,SP5=3` (skill
143 = "Stamina Recovery"). This isn't a parsing bug or a data error to reject:
the site's own point-totaling code (`calc()` in `SkillForm.js`) sums
contributions unconditionally by skill ID —

```js
for (var k = 0, eq = ...; k < 5; point[eq[I_bSN1+2*k]] += +eq[I_bSP1+2*k], k++);
```

— so wearing Endre F Guard genuinely contributes **+6** Stamina Recovery (3+3
from its two slots), not +3. Some of the 5 rows even have *different* point
values in the two slots (e.g. `arm:1DF4` has `SP3=3` and `SP5=5`), so this
isn't a copy-paste artifact either — it's how the game (and the site) treats
it. The parser sums duplicate skill IDs within a row to match, both because
it's the correct total and because the `equipment_skill`/`decoration_skill`
tables' `(equipment_id, skill_id)` primary key can't hold two rows for it
anyway.

## Equipment taxonomy

This is the master reference for "what category is this row, and where does
it go" — built up incrementally across several rounds of being wrong first
(slot_size as a junk proxy silently ate a real category; assuming an
early example row was a decoration when it was actually a Cuff; assuming
Tenfuu was one mechanism when it's three). Treat this section as the
current source of truth and keep it in sync as more is confirmed.

**Corroboration**: the source site's own navigation bar lists exactly these
categories as separate top-level tabs: `Head/SP · Chest/SP · Arm/SP ·
Waist/SP · Leg/SP · Decos/SP · Cuff/Z Cuff · Sigil(Info) · Tower Gem/Tower
Weap Sigil/Tower Armor Sigil` — i.e. the site itself treats Cuff vs. Z(enith)
Cuff, and Tower Gem vs. Tower Weapon Sigil vs. Tower Armor Sigil, as
distinct categories, matching everything below. The `/SP` suffix on each
armor slot and on `Decos` likely corresponds to the `CLASS="A"` ("ＳＰ")
tier — not yet investigated further.

### Overview

| Category | Found via | Modeled? | Count |
|---|---|---|---|
| Armor (normal) | `head`/`body`/`arm`/`wst`/`leg` buckets, `CLASS` not in `{N,P,Q}` | ✅ `Equipment` | 57,621 (61,817 total − 420 Tower − 3,776 Zenith) |
| **Tower Armor** | same buckets, `CLASS="N"` | ✅ `Equipment.is_tower` | 420 (84 × 5 slots) |
| **Zenith Armor** | same buckets, `CLASS="P"` or `"Q"` | ✅ `Equipment.zenith_skill_id` | 3,776 (1,773 `P` + 2,003 `Q`, verified 100% have a non-empty `Teni`, 0 exceptions) |
| Armor decoration | `deco` bucket, `DEC=""`, `slot_size` 1–3, `CLASS≠"N"` | ✅ `Decoration` | 2,485 |
| Tower Gem | `deco` bucket, `DEC=""`, `CLASS="N"` (subset of decorations) | ✅ `Decoration.is_tower` — exclusive-both-ways Tower compatibility confirmed, not yet enforced (Phase 3+ search engine concern) | 173 |
| UI placeholder junk | `deco` bucket, `DEC=""`, `slot_size=0` | ✅ filtered out | 3 |
| Cuff (regular + Hiden) | `deco` bucket, `DEC="1"`, no `Teni` | ✅ `Cuff` | 3,030 |
| **Zenith Cuff** ("SZ" variant) | `deco` bucket, `DEC="1"`, `CLASS="P"`, non-empty `Teni` | ✅ `Cuff.zenith_skill_id` | 276 |
| Tower Armor Sigil ("Tenkoku") | `deco` bucket, `DEC="2"` | ❌ deferred | 10 |
| Weapon Sigil ("Tenfuu") | `deco` bucket, `DEC="3"` (`CLASS="N"` or `"P"`) | ❌ deferred | 63 |

(**Correction, previously wrong here**: all 63 `DEC="3"` rows are Weapon
Sigils, not 37 Weapon Sigil + 26 Zenith Cuff. The `CLASS="P"` subset was
originally assumed to be an alternate, cheaper Zenith Cuff variant sharing
`DEC="3"` with real Tower Weapon Sigils -- wrong, see "Cuffs" below for how
this was caught and what it actually is.)

### Armor decorations (`DEC=""`, `slot_size` 1–3)

Socket into armor pieces' open slots. **Confirmed by the project owner**: an
armor piece's `slot_count` (`SLOT1`/`SLOT7`) is a plain count of
interchangeable, unsized open slot units -- not a list of individually-sized
slots. A decoration's own `slot_size` (`SLOT7` on a decoration row, 1–3) is
how many of those unit slots it consumes, and a decoration fits a piece as
long as the summed `slot_size` of everything socketed into it doesn't exceed
the piece's `slot_count`. (An earlier pass through this project briefly
modeled decorations as costing exactly one slot flat, ignoring `slot_size`
entirely -- also wrong, corrected back to this budget model.) Example:
`"Paralysis 1 Deco,0,0,4,,,,,,,57,2,46,-2,...,1-,,"` → a 1-slot-unit
decoration granting skill 57 (+2 points) and skill 46 (-2 points).

(`"Attack II PA1"`/`"Attack II PA2"` were our very first example rows, back
before the `DEC` field's meaning was known — they're actually Cuffs, not
decorations. Worth remembering that an example pulled before you understand
a field's semantics can be silently wrong.)

Three rows with `DEC=""` and `slot_size=0` (keys `""`, `"X"`→name `"●"`,
`"O"`→name `"○"`, all with `RECIPE1="なし"`/none) are UI selector-widget
placeholders (filled/empty circle icons), not items — the parser skips
`DEC="" AND slot_size==0`.

**Tower Gems** are a `CLASS="N"` subset of this same `DEC=""` group (173 of
the 2,658) — e.g. `Status Res Gem Ⅲ`, `RECIPE1="天廊宝箱報酬"` ("Tenrou
treasure box reward"). Mechanically these use the *same* armor slot type as
regular decorations (a 1–3 "open slot" count, same `Decoration`-shaped data),
but compatibility is **exclusive both ways**, confirmed by the project
owner: Tower armor **cannot** take regular decorations, and Tower Gems
**cannot** go into non-Tower armor. So although the slot *mechanism* is
shared, a Tower armor piece's slots and a normal armor piece's slots are
functionally two non-interchangeable pools — the same relationship Cuffs
have to armor decorations, just expressed as a compatibility rule on the
same underlying field rather than a separate slot-count field. Not yet
given a separate DB identity from plain `Decoration`; will need at least a
`is_tower` (or similar) flag on `Decoration`, mirrored on `Equipment`, so
the search engine can enforce the match.

### Cuffs (`DEC="1"`, full stop)

A **separate equipment category from armor decorations**, confirmed by the
project owner against actual game knowledge: cuffs occupy a separate
"Poogie slot" pool, not armor sockets, so they can't be mixed with armor
decoration slots in the data model. The game allows **at most 2 cuffs
equipped at once**, and each cuff's own `slot_size` (0, 1, or 2) counts
against a combined Poogie-slot budget — this is a build-time constraint for
the search engine (Phase 3+), not something that affects how a `Cuff` row
itself is stored.

Three sub-kinds, all real, all modeled in `Cuff` (`zenith_skill_id` column —
see below):

| `DEC` | `CLASS` | `Teni`? | Count | Example |
|---|---|---|---|---|
| `"1"` | `""` | No | 2,890 | `Artisan PA1` (2-slot) |
| `"1"` | `"L"` (G秘伝/G-Hiden) | No | 140 | `SnS・Basic` (0-slot, free) |
| `"1"` | `"P"` (辿異/Tan'i) | **Yes** | 276 | `Skill Slots Up SZ` (2-slot) |

- **Regular Cuffs** (`DEC="1"`, `CLASS=""`): e.g. `Sharpening PC1` (1-slot),
  `Artisan PA1` (2-slot). Spend Poogie-slot capacity, no Zenith skill.
- **Hiden Cuffs** (`DEC="1"`, `CLASS="L"`, `slot_size=0`): one
  weapon-technique tree per weapon type (e.g. `SnS・Basic`, `SnS・G`, then
  named variants like `SnS・Issen`, `SnS・Rush`, ...). Cost 0 Poogie-slot
  capacity, so effectively "always available" free bonuses (still counting
  toward the "max 2 cuffs" item-count limit).
- **"SZ"/"PZ..." Zenith Cuffs** (`DEC="1"`, `CLASS="P"`, `slot_size=2`): e.g.
  `Skill Slots Up SZ`, `Skill Slots Up PZ1`. **Not found until actually
  running the real pipeline and sanity-checking the loaded counts** — a
  plain DEC/CLASS/slot_size cross-tab of the `deco` bucket alone doesn't
  surface this, since these rows look like ordinary regular Cuffs except for
  also having a non-empty `Teni`. Empty `SN1–5` — grants *only* a Zenith
  skill.

**Corrected (previously wrong above): `DEC="3"`, `CLASS="P"` rows (e.g.
`Skill Slots Up Sigil`, `Hearing P. Up Sigil`) are *not* a cheaper,
1-Poogie-slot Zenith Cuff variant.** Originally assumed to be one, since
they share `CLASS="P"` and a populated `Teni` with real Zenith Cuffs and
`DEC="3"` with Tower Weapon Sigils (described as "shares `DEC` with Tower
Weapon Sigils, distinguished by `CLASS`" — reasonable on its face, but
wrong). Caught when the project owner reported two of them ("Hearing P. Up
Sigil", "Stylish Up Sigil") showing up as selectable Cuffs despite never
being equippable Poogie cuffs in the real game. Re-investigating the raw
`deco` bucket directly found:
- Every one of the 26 `DEC="3"`, `CLASS="P"` rows' `Teni` value already has
  a complete, independent `DEC="1"` "SZ"/"PZ..." Cuff family covering it —
  these rows add no Zenith skill a real Cuff doesn't already reach.
- Several of them have internally **inconsistent names for their own `Teni`
  value** — e.g. the row at `Teni=32` ("Vampirism Up") is itself named
  "Poison Res Up Sigil." No real, curated item row looks like this.
- The source site's own navigation bar (see "Corroboration" above) lists
  `Sigil(Info)` as a tab **separate from** `Cuff/Z Cuff` — i.e. the site
  itself doesn't consider these the same category.

All `DEC="3"` rows — `CLASS="N"` or `CLASS="P"` — are Weapon Sigils (see
"Deferred: Weapon Sigils" below), not Cuffs. `etl/src/etl/parse/equipment.py`'s
`_is_cuff_row` now checks `DEC == "1"` alone.

### Zenith skills (`Teni` field, `CLASS="P"`/`"Q"` equipment)

A skill system **separate from the normal `MST_Skill` table**, confirmed by
cross-tabulating `CLASS` against "has a non-empty `Teni` field" across the
full `head` bucket: **100% of `CLASS="P"` (361/361) and `CLASS="Q"`
(414/414) rows have a non-empty `Teni`, and 0% of every other class does** —
an exact, exception-free split. `Teni` indexes into `TENINAME` (52 entries:
`Skill Slots Up+1`...`+7`, `Crit Conversion Up+1/+2`, `Guard Up+1/+2`,
`Reflect Up+1/+2/+3`, `Vampirism Up+1/+2`, etc.), not `MST_Skill`.

Two *modeled* carriers, confirmed by the project owner (a third, unmodeled
one exists too — see below):

- **Zenith Armor** (`CLASS="P"`/`"Q"` in the armor buckets): carries normal
  skills via `SN1–5` *and* one Zenith skill via `Teni`, stacked. E.g.
  `Espinas Z Brain` grants skills 161/205/200/214/189 (4 pts each) **plus**
  Zenith skill `Teni=1` = "Skill Slots Up+1". Naming pattern is
  `<Monster> Z/ZF/ZY/ZX <PieceName>` (4 forge-independent tiers × usually 2
  piece-name variants per slot) spanning most of the monster roster —
  1,773 `CLASS="P"` pieces alone across the 5 armor buckets.

  `CLASS="Q"` (辿異狩護/"Tan'i-Shugo") also carries `Teni` 100% of the time;
  **confirmed by the project owner to be another tier of Zenith armor**,
  despite its different tier-naming (`ZP` rather than `Z/ZF/ZY/ZX`) and
  different flavor-text themes (e.g. `Dios ZP Head`: "armor tied to a
  hero's legend passed down in a foreign land"; `Evol ZP Head`: "armor
  developed in a foreign land, exuding luxury" — no monster-material
  crafting language like `CLASS="P"`'s Espinas/Rathalos/etc. lines, but
  still Zenith). Treat `CLASS="P"` and `CLASS="Q"` as one combined Zenith
  category for modeling purposes.
- **Zenith Cuffs** ("SZ"/"PZ..." at `DEC="1"`+`CLASS="P"`, see "Cuffs"
  above): carry *only* a Zenith skill via `Teni`, nothing via `SN1–5`.

A third carrier exists in the raw data but isn't modeled at all: **Zenith
Weapon Sigils** (`DEC="3"`+`CLASS="P"`, 26 rows, e.g. `Skill Slots Up
Sigil`) — see "Deferred: Weapon Sigils" below. Once wrongly modeled as a
cheaper Zenith *Cuff* variant; corrected after the project owner reported
two of them leaking into the Cuff picker as selectable (but never actually
equippable) Poogie cuffs.

Modeled (for the two carriers above) via a nullable `zenith_skill_id` column
on both `Equipment` and `Cuff`, resolved through a dedicated `zenith_skill`
table (populated from `TENINAME`, parallel to but separate from
`skill`/`MST_Skill`).

**Confirmed by the project owner: Zenith/Tan'i and Tower/Tenrou are entirely
unrelated systems** — not tiers of one system, not the same activity. Treat
`CLASS="N"` (Tower) and `CLASS="P"`/`"Q"` (Zenith) as fully independent
origin categories with no shared lineage, consistent with their flavor text
(Tower: generic "ancient techniques discovered in the Tenrou" lore; Zenith
`P`: monster-material crafting; Zenith `Q`: unrelated foreign-land/hero-
legend/luxury themes — see above).

### Exotic armor (`CLASS="O"`, bonus skill marker in `DOC`)

A fixed bonus to one **normal** skill (from the same `MST_Skill` catalog as
every other skill, not a separate pool like Zenith's `Teni`), granted just by
equipping any piece from an "Exotic" monster-material armor family — e.g.
every `Barioth`-series piece (Helm/Mail/Vest/Arms, every forge tier) grants
"Ice Attack (Large)" (20 points), *in addition to* its own normal `SN1–5`
skills. Reported by the project owner, confirmed against the raw data and the
site's own `SkillForm.js` (its "遷悠"/senyu-class branch):

```js
if (eq[I_bCLASS] === "O") { //遷悠
    var sen_skill_name = eq[I_bDOC].split("≪Exotic Armor：")[1].split("≫")[0]...;
    // ...matched against MST_Skill's own tier-name table, then forces that
    // skill active at that tier, unconditionally (not added as SN/SP points)
}
```

Confirmed **1:1 with `CLASS="O"`** across the full real dataset: exactly
688/688 `CLASS="O"` rows have the marker, 0 mismatches either direction, and
it's confined to the 5 armor buckets (0 occurrences in `deco`). Exactly **17
distinct markers** exist across the whole dataset (one fixed skill per Exotic
monster family, confirmed identical across every piece/forge-tier within a
family by checking all of Barioth's own rows) — each one manually
cross-referenced against that skill's own existing tier-threshold points
already in the `skill_tier` table (e.g. `Ice Attack 【Large】` → the "Ice
Attack" skill's "Ice Attack (Large)" tier, 20 points):

| Raw marker | Granted skill | Points |
|---|---|---|
| `Bomber` | Bomb Boost | 10 |
| `Critical Eye +5` | Expert | 50 |
| `Dragon Attack 【Large】` | Dragon Attack | 20 |
| `Evade+2` | Evasion | 20 |
| `Focus+2` | Focus | 20 |
| `Great Luck` | Fate | 20 |
| `Guard+2` | Guard | 20 |
| `Ice Attack 【Large】` | Ice Attack | 20 |
| `Maximum Bullets` | Ammo Combiner | 10 |
| `Pierce/Pierce Up` | Pierce Shot Up | 10 |
| `S. Immunity (Myriad)` | Status Res | 30 |
| `Sharpening Artisan` | Sharpening | 20 |
| `Starving Wolf+2` | Fasting | 20 |
| `Status Attack Up` | Status Attack | 10 |
| `Thunder Attack 【Large】` | Thunder Attack | 20 |
| `Water Attack 【Large】` | Water Attack | 20 |
| `Wide-Area+3` | Wide-Area | 30 |

**Modeled as a plain extra entry in the piece's own exported `skills` array**
(merged with its normal SN/SP contributions, summed if they happen to
coincide on the same skill id) rather than a new column/mechanism — this
reuses the search engine's existing additive skill-point machinery unchanged,
matching the "in addition to its other skills" framing directly. This is a
deliberate simplification of the site's own "force active at this tier,
unconditionally, don't double-count" semantics (relevant only to that site's
own point-display UI, not to this project's search engine) — see
`etl/src/etl/pipeline.py`'s `EXOTIC_ARMOR_SKILL_GRANTS` (the fixed
marker → (skill name, points) dict, resolved at `load_equipment` time rather
than dynamically against `skill_tier`, since tier data isn't loaded until
*after* equipment in `main()`) and `etl/src/etl/parse/equipment.py`'s
`_extract_exotic_skill_marker`.

### Tower Armor (`CLASS="N"` in the armor buckets)

420 pieces (84 × 5 slots), e.g. the `Ranvuo` series (`Ranvuo Helm`,
`Ranvuo F Helm`, `Ranvuo FY Helm`, ...). Flavor text ends in `≪天廊防具≫`
("Tenrou/Tower Armor") and reads "天廊にて発見された古代人の技術を利用し
造りあげた..." ("...crafted using ancient techniques discovered in the
Tenrou"). Structurally identical to normal `Equipment` rows (same 40
columns, same skill mechanics) — currently stored as plain `Equipment` with
no Tower-origin flag. Per the project owner, Tower armor is acquired from "a
specific activity" (a Tower-type raid/dungeon) and has unique compatibility
with Tower Gems and Tower Armor Sigils.

### Deferred: Tower Armor Sigil ("Tenkoku", `DEC="2"`)

10 rows. Each is a unique passive effect, resolved via `SN1` through a
*separate* lookup array (`TENKOKUNAME` in `SkillForm.js`, not `MST_Skill`
and not `TENINAME`) — Sharpness Up, Skill Up, Attack Power Up,
Element/Status Up, Distance Correction, Power Coating Up, Defense Up,
Damage Reduction, Auto Health Regen, G-Rank Armor.

### Deferred: Weapon Sigils ("Tenfuu", `DEC="3"`)

63 rows total, two `CLASS` subtypes — **neither is a Cuff** (see "Cuffs"
above for how the `CLASS="P"` subset was once wrongly modeled as one):

- **`CLASS="N"` — Tower Weapon Sigil (37 rows)**, two sub-mechanics:
  1. **Weapon enchants** (`SN1`→`TENFUNAME` indices 1–4): add an
     element/status/crit/ammo-type property to a weapon that doesn't
     normally have one.
  2. **Named special techniques per weapon type** (`SN1`→`TENFUNAME`
     indices 17–25), e.g. `[SnS] Beam Slash`, `[Hammer] Charge Ⅰ/Ⅱ/Ⅲ`.
- **`CLASS="P"` — Zenith Weapon Sigil (26 rows)**, e.g. `Skill Slots Up
  Sigil`, `Hearing P. Up Sigil`: a non-empty `Teni` on a `DEC="3"` row
  grants a Zenith skill the same way a Zenith armor/Cuff row's `Teni` does
  — just attached to a weapon-sigil slot instead of an armor piece or a
  Poogie cuff slot. Not yet confirmed which weapon types can socket these
  or whether they require a Tower weapon like the `CLASS="N"` ones do.

**Confirmed mechanism** (project owner): "Sigils" are one general weapon
customization system — the site's `Sigil(Info)` page describes the slot
mechanic itself (up to 3 sigils per weapon, up to 3 on a G-rank weapon;
removing one needs a "Sigil Catalyst"). **Tower weapons can only equip
Tower Weapon Sigils** (the 37 `CLASS="N"` rows above); **every other weapon
uses "regular" sigils** (see below) — where the 26 `CLASS="P"` Zenith
Weapon Sigils fit into this isn't confirmed yet, out of scope for now along
with the rest of this deferred section.

### Deferred: regular (non-Tower) weapon Sigils — `bougu/sigil.htm`

**Located.** Unlike everything else in this document, these are **not** in
`equip.js` at all — they live as a plain HTML `<table>` on
`bougu/sigil.htm` (324 rows, no JSON bucket, no `SkillForm.setEquip` call).
Extracted in full to
[`docs/reference/regular-sigils.json`](reference/regular-sigils.json) for
whenever weapons are tackled (each entry: `name`, `effects` — a list of
`{effect, range}` pairs, or the literal string `"Unknown"` for the 8
mystery-crate rows — `chances` (one success % per effect, same order),
`grade` (rank requirement), `price`, `creation_mats`/`intrinsic_mats`
(crafting materials, `{item, qty}` pairs)).

**Structurally different from everything else in this document**: Equipment/
Decoration/Cuff are all deterministic (a given item always has the same
fixed stats). Regular Sigils are **crafting recipes with a per-effect
success chance and a value range**, not fixed-stat items — e.g. `Hypnoc ★`
has 4 possible outcomes (3 different `Tech Boost[Hammer]` variants + `Stun
Value`), each independently at 8–20% success; `G Promo Sigil` has 6 possible
outcomes mixing stat adjustments (Affinity/Defense/Attack) with conditional
bonuses (Saturday/Sunday/Bird Wyvern); `GR1 Gem`/`GR2 Gem`/`Mystery Sigil`
have effect `"Unknown"` entirely (pure random-outcome crates). Whenever
weapons are modeled, this probabilistic shape will need its own schema
treatment — it doesn't fit the `(name, fixed skills)` pattern used
everywhere else in this project. Deferred until then; not referenced by the
ETL pipeline or ETL tests.

### Open questions (actively being researched)

- `CRE` field (see "Acquisition method" below) and the broader
  acquisition/origin tagging seen in the site's armor-tree legend (Hunting/
  Gathering/Quest/Gou/Hiden/G Rank/Exotic/Zenith/Road/Diva Battle/Prize/
  Guild/Festival/Interception/Event/NetCafe/Lottery/Premium/Bundle/
  Subscription/Training(lend)/Not Implemented) — likely a blend of `CRE`
  (acquisition method) and `CLASS` (origin tier) into one visual legend;
  not yet reconciled field-by-field. Lower priority than the categories
  above.

### CLASS field — full decode table (`CLASSTYPE` in `SkillForm.js`)

| Code | Japanese | Notes |
|---|---|---|
| `""` | (none) | Normal equipment |
| `A` | ＳＰ | "SP" tier — matches the site nav's `/SP` tab suffix, not yet investigated |
| `B` | 剛種 (Goushu) | |
| `C` | 天嵐 (Tenran) | |
| `D` | 覇種 (Hashu) | |
| `E` | ＨＣ | "Hard Core" |
| `F` | 狩護 (Shugo) | |
| `G` | G覇種 (G-Hashu) | |
| `H` | 烈種 (Resshu) | |
| `I` | Ｇ級 (G-class) | |
| `J` | G狩護 (G-Shugo) | G-rank sibling of `F` (grouped together as `Shugo:"FJQ"` in the site's own code) |
| `K` | 秘伝 (Hiden) | |
| `L` | G秘伝 (G-Hiden) | Hiden Cuffs |
| `M` | 始種 (Sisyu) | |
| `N` | 天廊 (Tenrou) | **Tower** |
| `O` | 遷悠 (Sen'yuu) | |
| `P` | 辿異 (Tan'i) | **Zenith** |
| `Q` | 辿異狩護 (Tan'i-Shugo) | **Zenith** — confirmed another tier of `P`, despite different naming/flavor-text conventions |

### Acquisition method (`CRE` field, `MAKENAME` in `SkillForm.js`)

`CRE` is a short code whose first character and remainder (minus any `#`)
are each looked up separately in `MAKENAME` — e.g. `CRE="4k"` → `4`="課金"
(cash shop) + `k`="キット" (kit). Not modeled yet; noting the lookup table
for later:

`""`/`"1"`/`"-"` = (blank), `"2"`="猟団" (Guild), `"3"`="カフェ" (NetCafe),
`"4"`="課金" (cash shop/subscription), `"5"`="特典" (bonus/premium),
`"e"`="イベント" (Event), `"es"`="イベ/狩衛戦", `"s"`="狩衛戦" (Diva
Battle?), `"t"`="狩煉道" (a training-ground mode — possibly *not* the same
as Tower), `"u"`="迎撃戦" (Interception), `"m"`="狩人祭" (Hunter Festival),
`"c"`="パローネ", `"g"`="ガチャ" (Gacha/Lottery), `"k"`="キット" (Kit),
`"i"`="韋駄天", `"p"`="パッケ" (Bundle/Package).

## Skill names (`var MST_Skill = [...]` in `SkillForm.js`)

A ~225-entry JS array literal, **not valid JSON** (uses array holes like
`[,,]` for skipped positions), so it needs its own line-oriented extraction
rather than `json.loads`. Each skill is one line: `["Name", <threshold
pairs...>],`. The **array position is the skill ID** (0 = `"None"`, 1 =
`"Passive"`, 2 = `"Fate"`, ...) — confirmed by counting: 227 lines in the
isolated `[...]` block, 225 match the per-entry pattern, the other 2 are the
block's own opening `[` and closing `]`.

Extraction: isolate the `var MST_Skill = [ ... ];` block via the same
bracket-depth scan used for equip.js, split into lines, and for each line
matching `^\[\s*"((?:\\.|[^"\\])*)"`, the capture group is the name; the
running match count is the skill ID.

**Quirk**: the first entry is literally `["﻿None", ...]` — a stray
byte-order-mark character glued onto the string. Strip `﻿` (and
whitespace) from every parsed name.

## The `"0000"` placeholder in armor buckets

Found by actually running the pipeline against the live ~11MB dataset — it's
silent in the sense that it doesn't throw on its own, so it needs explicit
filtering rather than relying on a parse error to catch it. Every armor
bucket (`head`/`body`/`arm`/`wst`/`leg`) has an identical `"0000"` entry
named 仮装備 ("dummy/temporary equipment"): the skill simulator's "nothing
selected" sentinel, not a real item. Its stats (`SLOT7=3`, `DEF=0`, etc.) are
all individually valid-looking, so it doesn't trip any CHECK constraint on
its own — the parser skips external ID `"0000"` in every armor bucket.

## External IDs

The hex keys (e.g. `"0001"`) are only unique **within** a bucket — the same
key exists in `head`, `body`, etc. as unrelated items, and the `deco` bucket
mixes Decorations and Cuffs in one key namespace too. External IDs are
therefore always `f"{bucket}:{hex_id}"` for armor (e.g. `"head:0001"`),
`f"deco:{hex_id}"` for decorations, and `f"cuff:{hex_id}"` for cuffs (not
`"deco:{hex_id}"` for cuffs, even though they're read from the same JS
bucket — the prefix reflects our own category, not the source's).
