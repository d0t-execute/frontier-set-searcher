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
| 33 | **CRE** | Acquisition-method code, e.g. `"4k"` — two sub-codes looked up in `MAKENAME` (see "Acquisition method" below). Not modeled yet. |
| 34 | **DEC** | **Equipment category signifier #1** — see "Equipment taxonomy" below. `""` = armor decoration (or normal armor), `"1"` = Cuff, `"2"` = Tower Armor Sigil, `"3"` = Tower Weapon Sigil |
| 35 | **CLASS** | **Equipment category signifier #2** — origin/rarity tier (full table in "Equipment taxonomy"). Distinguishes e.g. a Hiden Cuff (`"L"`) from a regular one, and Tower (`"N"`) / Zenith (`"P"`/`"Q"`) equipment from normal gear |
| 36 | TrSLOT | Out of scope |
| 37 | **Teni** | **Zenith skill** carried by `CLASS="P"`/`"Q"` equipment (armor or Cuff) — an *additional* skill beyond SN1–5, resolved through a third lookup array, `TENINAME`, not `MST_Skill`. See "Equipment taxonomy" |
| 38 | DOC | Flavor text — often names the category outright, e.g. `≪天廊防具≫` ("Tower Armor") or `≪辿異防具≫` ("Zenith Armor") |
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
| Armor (normal) | `head`/`body`/`arm`/`wst`/`leg` buckets, `CLASS` not in `{N,P,Q}` | ✅ `Equipment` | ~59,000 |
| **Tower Armor** | same buckets, `CLASS="N"` | ⚠️ stored as plain `Equipment`, Tower-origin not flagged | 420 (84 × 5 slots) |
| **Zenith Armor** | same buckets, `CLASS="P"` or `"Q"` | ⚠️ stored as plain `Equipment`, `Teni` (Zenith skill) not captured | 1,773 `CLASS="P"` (across 5 slots); `CLASS="Q"` not yet totaled (414 in `head` alone) |
| Armor decoration | `deco` bucket, `DEC=""`, `slot_size` 1–3 | ✅ `Decoration` | 2,658 |
| Tower Gem | `deco` bucket, `DEC=""`, `CLASS="N"` (subset of the above) | ⚠️ currently stored as an undifferentiated `Decoration` — compatibility restriction (Tower-only) not captured | 173 |
| UI placeholder junk | `deco` bucket, `DEC=""`, `slot_size=0` | ✅ filtered out | 3 |
| Cuff (regular + Hiden) | `deco` bucket, `DEC="1"` | ✅ `Cuff` | 3,306 |
| **Zenith Cuff** | `deco` bucket, `DEC="3"`, `CLASS="P"` | ❌ currently deferred along with Tower Weapon Sigil — needs to move into `Cuff` plus a `Teni`/Zenith-skill column | 26 |
| Tower Armor Sigil ("Tenkoku") | `deco` bucket, `DEC="2"` | ❌ deferred | 10 |
| Tower Weapon Sigil ("Tenfuu") | `deco` bucket, `DEC="3"`, `CLASS="N"` | ❌ deferred | 37 |

(Tenfuu's 63 total = 37 Tower Weapon Sigil + 26 Zenith Cuff, cleanly split by
`CLASS`.)

### Armor decorations (`DEC=""`, `slot_size` 1–3)

Socket into armor pieces' open slots, same as always assumed. `SLOT7` holds
the decoration's own slot size (1–3). Example:
`"Paralysis 1 Deco,0,0,4,,,,,,,57,2,46,-2,...,1-,,"` → a 1-slot decoration
granting skill 57 (+2 points) and skill 46 (-2 points).

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
treasure box reward"). Per the project owner, mechanically these use the
*same* armor slot type as regular decorations, just restricted to socketing
into Tower armor specifically (regular decorations presumably can't go into
a Tower armor's slot, or Tower Gems can't go into normal armor's slot, or
both — exact restriction direction still to confirm). Not yet given a
separate DB identity from plain `Decoration`.

### Cuffs (`DEC="1"`, plus Zenith Cuffs at `DEC="3"`+`CLASS="P"`)

A **separate equipment category from armor decorations**, confirmed by the
project owner against actual game knowledge: cuffs occupy a separate
"Poogie slot" pool, not armor sockets, so they can't be mixed with armor
decoration slots in the data model. The game allows **at most 2 cuffs
equipped at once**, and each cuff's own `slot_size` (0, 1, or 2) counts
against a combined Poogie-slot budget — this is a build-time constraint for
the search engine (Phase 3+), not something that affects how a `Cuff` row
itself is stored.

Three sub-kinds, all real:

- **Hiden Cuffs** (`DEC="1"`, `CLASS="L"` i.e. "G秘伝"/G-Hiden,
  `slot_size=0`): 140 entries, one weapon-technique tree per weapon type
  (e.g. `SnS・Basic`, `SnS・G`, then named variants like `SnS・Issen`,
  `SnS・Rush`, ...). Since they cost 0 Poogie-slot capacity, these are
  effectively "always available" free bonuses (though still counting toward
  the "max 2 cuffs" item-count limit).
- **Regular Cuffs** (`DEC="1"`, `CLASS=""`, `slot_size=1` or `2`): e.g.
  `Sharpening PC1` (1-slot), `Artisan PA1` (2-slot). Spend Poogie-slot
  capacity.
- **Zenith Cuffs** (`DEC="3"`, `CLASS="P"`, `slot_size=1`): e.g.
  `Skill Slots Up Sigil`, `Crit Conv Up Sigil`. Confirmed by the project
  owner to be Cuffs mechanically, despite sharing `DEC="3"` with Tower
  Weapon Sigils in the raw data — distinguished from those by `CLASS="P"`
  vs. `"N"`. All 26 have **empty `SN1–5`** and a populated `Teni` field —
  they grant *only* a Zenith skill (via `Teni`→`TENINAME`, see below), no
  normal skill at all. **Not yet moved out of the deferred bucket into
  `Cuff`** — needs a `Teni`/Zenith-skill column added to `Cuff` first (see
  "Zenith skills" below), since the existing `Cuff` schema has nowhere to
  put it.

### Zenith skills (`Teni` field, `CLASS="P"`/`"Q"` equipment)

A skill system **separate from the normal `MST_Skill` table**, confirmed by
cross-tabulating `CLASS` against "has a non-empty `Teni` field" across the
full `head` bucket: **100% of `CLASS="P"` (361/361) and `CLASS="Q"`
(414/414) rows have a non-empty `Teni`, and 0% of every other class does** —
an exact, exception-free split. `Teni` indexes into `TENINAME` (52 entries:
`Skill Slots Up+1`...`+7`, `Crit Conversion Up+1/+2`, `Guard Up+1/+2`,
`Reflect Up+1/+2/+3`, `Vampirism Up+1/+2`, etc.), not `MST_Skill`.

Two carriers, confirmed by the project owner:

- **Zenith Armor** (`CLASS="P"`/`"Q"` in the armor buckets): carries normal
  skills via `SN1–5` *and* one Zenith skill via `Teni`, stacked. E.g.
  `Espinas Z Brain` grants skills 161/205/200/214/189 (4 pts each) **plus**
  Zenith skill `Teni=1` = "Skill Slots Up+1". Naming pattern is
  `<Monster> Z/ZF/ZY/ZX <PieceName>` (4 forge-independent tiers × usually 2
  piece-name variants per slot) spanning most of the monster roster —
  1,773 `CLASS="P"` pieces alone across the 5 armor buckets, plus `CLASS="Q"`
  (likely a higher-defense "Shugo" sibling tier, see CLASS table below;
  not yet counted separately).
- **Zenith Cuffs** (`DEC="3"`, `CLASS="P"`, see above): carry *only* a
  Zenith skill via `Teni`, nothing via `SN1–5`.

Not yet modeled: `Equipment` and `Cuff` both need a nullable Zenith-skill
column (something like `zenith_skill_id`, resolved through a new
`TENINAME`-backed lookup, parallel to but separate from the `skill` table).

**Important distinction** (from the project owner, flavor-text-confirmed):
Zenith/Tan'i (`CLASS="P"`/`"Q"`) and Tower/Tenrou (`CLASS="N"`) read as two
*separate* systems, not tiers of one system. Tower armor's flavor text is
generic lore about "ancient techniques discovered in the Tenrou"; Zenith
armor's is monster-material crafting text (e.g. "armor decorated with sharp
spines, made from Espinas materials") ending in `≪辿異防具≫` ("Tan'i
Armor") — a different naming/crafting pattern with no tower-discovery
language. Needs independent confirmation against actual game knowledge
(in progress), but nothing in the data contradicts "separate systems."

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
Damage Reduction, Auto Health Regen, G-Rank Armor. Per the site's own info
page (`Sigil(Info)` tab): "up to three special effects can be attached to
each sigil, and up to three can be put onto a G-rank weapon... to remove a
sigil, a 'Sigil Catalyst' is required." (That info page's effect table —
Attack/Attribute/Status/Affinity/Defense Adjustment — describes small numeric
weapon-stat tweaks and might be a related-but-distinct general "Sigil"
reforging mechanic rather than Tenkoku/Tenfuu specifically; not yet
reconciled with the itemized Tenkoku/Tenfuu rows above — open question.)

### Deferred: Tower Weapon Sigil ("Tenfuu" minus Zenith Cuffs, `DEC="3"`, `CLASS="N"`)

37 rows (63 total `DEC="3"` rows minus the 26 `CLASS="P"` Zenith Cuffs
above), two sub-mechanics, both weapon-only per the project owner:

1. **Weapon enchants** (`SN1`→`TENFUNAME` indices 1–4): add an
   element/status/crit/ammo-type property to a weapon that doesn't normally
   have one.
2. **Named special techniques per weapon type** (`SN1`→`TENFUNAME` indices
   17–25), e.g. `[SnS] Beam Slash`, `[Hammer] Charge Ⅰ/Ⅱ/Ⅲ`.

### Open questions (actively being researched)

- Exact mechanical direction of the Tower Gem / Tower armor slot
  restriction (can non-Tower decorations go into Tower armor slots? can
  Tower Gems go into normal armor slots? project owner says "same slot
  type, restricted compatibility" — need the precise rule before adding a
  compatibility column).
- Whether `CLASS="Q"` (辿異狩護/"Tan'i-Shugo") is simply the higher-defense
  sibling tier of `CLASS="P"` within the same Zenith system (by analogy
  with `J`="G狩護" being `F`="狩護"'s G-rank sibling) — looks likely from
  the `CLASSTYPE` grouping helpers in `SkillForm.js` (`Shugo:"FJQ"` groups
  F/J/Q together) but not independently confirmed.
- Whether Zenith/Tan'i (`P`/`Q`) and Tower/Tenrou (`N`) are fully separate
  activities/systems, or related tiers — project owner is verifying against
  actual game knowledge.
- The site's general "Sigil" info page (weapon stat adjustment: Attack
  ±10–15, Attribute ±10–15, Status ×1.1, Affinity ±10, Defense ±10–20) vs.
  the itemized Tenkoku/Tenfuu rows: same system described two ways, or two
  different systems that happen to share the word "Sigil"?
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
| `Q` | 辿異狩護 (Tan'i-Shugo) | Grouped with `F`/`J` as `Shugo:"FJQ"` — likely Zenith's G-rank/Shugo sibling, unconfirmed |

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
