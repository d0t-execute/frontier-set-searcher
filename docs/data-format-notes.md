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
| 2 | TYPE | 0=Common, 1=Blademaster, 2=Gunner |
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
| 33 | CRE | Crafting metadata (out of scope) |
| 34 | **DEC** | **Deco-bucket item category** — see "What's actually in the `deco` bucket" below. `""` = armor decoration, `"1"` = Cuff, `"2"`/`"3"` = Tenkoku/Tenfuu (deferred, not modeled yet) |
| 35 | CLASS | Rarity/origin tier marker (e.g. `I`=G-rank, `L`=G-Hiden, `N`=Tenrou/Zenith-tier, `P`=Tan'i-tier) — not modeled as a DB column yet, but is what distinguishes a Hiden Cuff (`CLASS="L"`) from a regular one |
| 36 | TrSLOT | Out of scope |
| 37 | **Teni** | A *fourth* item-category field, used only by one `DEC="3"` sub-group (see below) — out of scope along with the rest of that group |
| 38 | DOC | Flavor text |
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

## What's actually in the `deco` bucket

The `deco` bucket shares the same 40-column row shape as the armor buckets
(`LVUPPTN` is empty for every row in it — none of these have forge levels),
but it is **not** just "armor decorations". It's several distinct equipment
categories that happen to share this one JS bucket and the same SN/SP
skill-point plumbing. The `DEC` field (index 34) is what actually
distinguishes them — initially I used `slot_size` (`SLOT7`) as a proxy for
"is this real," which happened to isolate the junk rows but also silently
discarded an entire real category (Cuffs) along with it. Cross-tabulating
`DEC` × `CLASS` × `slot_size` against the real dataset gives a clean picture
(confirmed against the full 6,040-row bucket):

| `DEC` | Category | Count | `slot_size` range |
|---|---|---|---|
| `""` | **Armor decoration** | 2,458 | 1–3 |
| `""`, `slot_size=0` | *(junk — see below, not a category)* | 3 | 0 |
| `"1"` | **Cuff** | 3,306 | 0, 1, 2 |
| `"2"` | Tenkoku ("Sigil") — deferred | 10 | 1–3 |
| `"3"` | Tenfuu ("Sigil") — deferred | 63 | 1 |

### Armor decorations (`DEC=""`)

Socket into armor pieces' open slots, same as always assumed. `SLOT7` holds
the decoration's own slot size (1–3). Example:
`"Paralysis 1 Deco,0,0,4,,,,,,,57,2,46,-2,...,1-,,"` → a 1-slot decoration
granting skill 57 (+2 points) and skill 46 (-2 points).

(`"Attack II PA1"`/`"Attack II PA2"` were our very first example rows, back
before the `DEC` field's meaning was known — they're actually Cuffs, not
decorations; see below. Worth remembering that an example pulled before you
understand a field's semantics can be silently wrong.)

Three rows with `DEC=""` and `slot_size=0` (keys `""`, `"X"`→name `"●"`,
`"O"`→name `"○"`, all with `RECIPE1="なし"`/none) are UI selector-widget
placeholders (filled/empty circle icons), not items — the parser skips
`DEC="" AND slot_size==0`.

### Cuffs (`DEC="1"`)

A **separate equipment category from armor decorations**, confirmed by the
project owner against actual game knowledge: cuffs occupy a separate
"Poogie slot" pool, not armor sockets, so they can't be mixed with armor
decoration slots in the data model. The game allows **at most 2 cuffs
equipped at once**, and each cuff's own `slot_size` (0, 1, or 2) counts
against a combined Poogie-slot budget — this is a build-time constraint for
the search engine (Phase 3+), not something that affects how a `Cuff` row
itself is stored.

Two sub-kinds, both real and both modeled identically (just `slot_size`
differs):

- **Hiden Cuffs** (`CLASS="L"`, i.e. "G秘伝"/G-Hiden, `slot_size=0`): 140
  entries, one weapon-technique tree per weapon type (e.g. `SnS・Basic`,
  `SnS・G`, then named variants like `SnS・Issen`, `SnS・Rush`, ...). Since
  they cost 0 Poogie-slot capacity, these are effectively "always available"
  free bonuses — one of these can be equipped without spending any of the 2
  cuff budget's slot capacity (though it still counts toward the "max 2
  cuffs" item-count limit).
- **Regular Cuffs** (`CLASS=""` or `CLASS="P"`, `slot_size=1` or `2`): e.g.
  `Sharpening PC1` (1-slot), `Artisan PA1` (2-slot), `Skill Slots Up SZ`
  (2-slot, `CLASS="P"` = a higher "Tan'i" tier). These do spend Poogie-slot
  capacity.

### Deferred: Tenkoku/Tenfuu (`DEC="2"`/`"3"`)

Confirmed (by the project owner, cross-referenced against
[mertna.github.io/MHFZ-Skills](https://mertna.github.io/MHFZ-Skills/)) to be
real, relevant systems — just not central to the initial armor/cuff set
searcher, so **not modeled yet**. Noting what they are so a future phase
doesn't have to re-derive this:

- **Tenkoku** (`DEC="2"`, 10 rows): each is a unique passive effect
  ("Sigil"), resolved via `SN1` through a *separate* lookup array
  (`TENKOKUNAME` in `SkillForm.js`, not the normal `MST_Skill` table) —
  Sharpness Up, Skill Up, Attack Power Up, Element/Status Up, Distance
  Correction, Power Coating Up, Defense Up, Damage Reduction, Auto Health
  Regen, G-Rank Armor.
- **Tenfuu** (`DEC="3"`, 63 rows) is itself three different sub-mechanics,
  all under the "Sigil" umbrella per the project owner, slotting into a
  weapon's sigil slots (separate from, or hybrid with, its decoration
  slots, depending on the weapon):
  1. **Weapon enchants** (`CLASS="N"`, `SN1`→`TENFUNAME` indices 1–4): add
     an element/status/crit/ammo-type property to a weapon that doesn't
     normally have one.
  2. **Named special techniques per weapon type** (`CLASS="N"`,
     `SN1`→`TENFUNAME` indices 17–25), e.g. `[SnS] Beam Slash`,
     `[Hammer] Charge Ⅰ/Ⅱ/Ⅲ`.
  3. **Tiered "+N" buffs** (`CLASS="P"`, `SN1` empty — resolved instead via
     a *fourth* field, `Teni` at index 37, through a *third* lookup array,
     `TENINAME`): `Skill Slots Up+1`...`+7`, `Crit Conversion Up+1/+2`,
     `Guard Up+1/+2`, etc. Per the project owner these are **"Zenith
     skills"**, attachable to any of: an armor piece, the weapon, or a
     Poogie cuff — a cross-cutting system, unlike Tenkoku/Sigils which are
     weapon-only.

The parser skips `DEC="2"`/`"3"` entirely for now (they land in neither
Decoration nor Cuff).

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
