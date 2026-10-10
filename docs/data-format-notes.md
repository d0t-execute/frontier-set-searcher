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
| 32–39 | UPGCNT, CRE, DEC, CLASS, TrSLOT, Teni, DOC, IMG | Crafting/flavor/UI metadata (out of scope except DOC = flavor text) |

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

## Decorations

Same 40-column row shape (the site's own code iterates `head`/`body`/`arm`/
`wst`/`leg`/`deco` identically). For a decoration row, `LVUPPTN` is empty, and
`SLOT7` holds the decoration's own **slot size** (1–3) rather than a max-slots
value. Example: `"Attack II PA1,0,0,5,,,,,,,21,5,67,2,...,,2,,,,,4k,1,"` → a
2-slot decoration granting skill 21 (+5 points) and skill 67 (+2 points).

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

## External IDs

The hex keys (e.g. `"0001"`) are only unique **within** a bucket — the same
key exists in `head`, `body`, etc. as unrelated items. Our `Equipment.external_id`
(globally unique per Phase 1's schema) is therefore `f"{bucket}:{hex_id}"`,
e.g. `"head:0001"`.
