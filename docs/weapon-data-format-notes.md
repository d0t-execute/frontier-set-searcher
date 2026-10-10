# Weapon data format notes

Reconnaissance pass over the weapon side of the site, parallel to
`docs/data-format-notes.md` (which covers armor/decorations/cuffs). Nothing
has been extracted or modeled in code yet — this is purely "how does the
data work and how big is it," gathered before deciding what to build.

## This is a completely different data shape from armor

`skill/equip.js` (the JSON-bucket file armor comes from) has **no weapon
data at all** — confirmed earlier (no `buki` bucket). Weapons live under
`buki/` as a set of plain HTML `<table>`s, one per weapon type per
"variant" (see below) — same general shape as `bougu/sigil.htm`, not
`equip.js`.

## Site structure

`buki/bukiF.htm` is a frameset wrapper; the real content is
`buki/buki.htm`, which lists all 14 weapon types, each linking to its own
page, plus up to 3 more "variant" pages per type:

| Weapon type | Base page | Variants seen |
|---|---|---|
| Great Sword | `taiken.htm` | `_g`, `_s`, `_n` |
| Long Sword | `tachi.htm` | `_g`, `_s`, `_n` |
| SnS | `katate.htm` | `_g`, `_s`, `_n` |
| Dual Swords | `souken.htm` | `_g`, `_s`, `_n` |
| Hammer | `hammer.htm` | `_g`, `_s`, `_n` |
| Hunting Horn | `horn.htm` | `_g`, `_s`, `_n` |
| Lance | `lance.htm` | `_g`, `_s`, `_n` |
| Gunlance | `gunlance.htm` | `_g`, `_s`, `_n` |
| Tonfa | `tonfa.htm` | `_g`, `_s` (no `_n`) |
| Switch Axe F | `slaxe.htm` | `_g`, `_s` (no `_n`) |
| Magnet Spike | `magspike.htm` | `_s` only (no `_g`, no `_n`) |
| LBG | `right.htm` | `_g`, `_s` (no `_n`) |
| HBG | `heavy.htm` | `_g`, `_s` (no `_n`) |
| Bow | `yumi.htm` | `_g`, `_s`, `_n` |

## The four "variants" are different systems, not pagination

This was the big surprise — `_g`/`_s`/`_n` aren't just "more pages of the
same catalog," each represents a **different weapon-acquisition mechanic**,
confirmed by materials/flavor text, not assumed from the URL:

- **Base** (no suffix): the normal weapon catalog — craft/upgrade trees,
  same shape conceptually as armor's upgrade chains. **15,594 rows total**
  across all 14 types. Includes Tower and Zenith weapons (see below).
- **`_g`**: a **G-rank custom-crafting system** — rows have an `Lv1`-style
  level suffix on the name, `GR`-prefixed rarity, and two *percentage-named*
  material columns (`100%Creation Mats` / `60%Creation Mats`) instead of
  the base tier's `Creation Mats`/`Upgrade Mats` — i.e. a probabilistic
  crafting system, structurally similar to the regular (non-Tower) weapon
  Sigils already found and deferred in `docs/data-format-notes.md`.
  **48,350 rows total** — the single biggest chunk of weapon data.
- **`_s`** ("Ravi"): **Raviente siege-boss crafting** — confirmed by
  materials (`Raviente Blood`/`Scale`/`Wing`/`Horn`) and flavor text
  (`≪進化武器≫` = "Evolution Weapon", struck through in a `<s>` tag). Also
  `Lv1`-leveled. **75,400 rows total** — the single biggest chunk by far
  (54% of all weapon rows).
- **`_n`** ("RNGCat"): a small separate category, flavor-tagged
  `RNG Cat Weapon`. Tiny — **288 rows total**, and entirely absent for 5 of
  the 14 weapon types (Tonfa, Switch Axe F, Magnet Spike, LBG, HBG).

**Grand total: 139,632 rows** across all types/variants — more than double
the entire armor dataset (~68,000 rows across `Equipment`/`Decoration`/
`Cuff`). The base tier alone (15,594) is comparable in size to one armor
slot; `_g` and `_s` together are 89% of the weapon dataset and are both
probabilistic/leveled crafting systems rather than simple fixed-stat
catalogs — the same shape problem already flagged for regular Sigils.

## Base-tier column layout (melee weapons)

Real headers (the raw `<thead>` text is polluted with an injected sort/filter
`<select>`'s full option list, same pattern as `bougu/sigil.htm` — strip
`select`/`div` children before reading): confirmed identical across Great
Sword, Hunting Horn, and Gunlance (all melee):

`Name, Rarity, Attributes, Sharpness, Slots, Rank, Price, Creation Mats, Upgrade Mats, Description`

- **Attributes**: Attack + Affinity on one line (`"288 0%"`), then optional
  extra lines via `<br>`: element + value (`"Water 470"`), and/or a flat
  stat bonus (`"Defense +15"`).
- **Sharpness**: two `<ul>` sharpness-bar elements (base and
  Handicraft-maxed), each a sequence of `<li class="COLOR sLENGTH">` —
  color code (`r`/`o`/`y`/`g`/`b`/`w`/`p`/`s`, presumably
  red/orange/yellow/green/blue/white/purple/+1-more ascending sharpness
  tiers) plus a numeric segment length. The first `<ul>` also carries a
  `title="xxxxxx"` hex attribute that likely compactly encodes the same bar
  — not decoded yet, probably unnecessary since the `<li>` list is already
  directly usable. **This cell is also where weapon-type-specific extras
  get tucked in** as additional inline elements after the two `<ul>`s:
  - Hunting Horn: an `<a class="f">` with song-note `<span>`s.
  - Gunlance: `<small>Spread Shot LV2</small>` (shelling type + level).
  - Switch Axe F: `<small>Ele Phial</small>` (phial type).
  - Any weapon: `<small>Length：Short</small>` (physical reach category).
  - Zenith weapons: `<q>Zenith Skill：Skill Slots Up+1</q>` (see below).
- **Slots**: plain integer, same concept as armor.
- **Rank**: `"HR<br>1"` / `"GR<br>200"` etc. — rank-type + number, given as
  plain readable text (unlike armor's cryptic numeric `HR1` field).
- **Price**: zenny cost, optionally with a second `<br>`-separated line
  naming the acquisition method directly in English (`Cafe`, `Package`,
  `Gacha`, `Kits`) — much more directly usable than armor's `CRE`/
  `MAKENAME` code pair.
- **Creation Mats** / **Upgrade Mats**: material links + quantities, same
  shape as armor/decoration recipes.
- **Description**: flavor text. The category tag (see below) sometimes
  additionally appears struck-through here too, redundant with the `<p>`
  tag in the Name cell.

## Ranged weapons have a different column layout entirely

Confirmed via Bow and LBG — not just extra inline elements in a shared
column, but different headers altogether:

- **Bow**: `Name, Rarity, Attack Attribute, Charge Stage, Coatings, Slots, Rank, Price, Creation Mats, Upgrade Mats, Description`
  — `Charge Stage` lists per-charge-level shot types (e.g.
  `1:RpdLV1<br>2:SprLV1<br>3:RpdLV3<i>4:SprLV3</i>`); `Coatings` lists which
  coating types the bow can use.
- **LBG**: `Name, Rarity, Attack, Reload/Recoil/Bullet Speed, Ammo, Slots, Rank, Price, Creation Mats, Upgrade Mats, Description`
  — `Ammo` is a dense nested list of every ammo/coating type and its level
  cap per tier (`Norm：6/6/9`, `Pierc：2/2/2`, `Psn：-/-`, `Flame：-`,
  `Tranq：2`, ...). Substantially more complex to parse than anything seen
  so far in this project. HBG is presumably the same shape (not yet
  checked); Gunlance/Switch Axe F/Tonfa/Magnet Spike are melee-shaped
  (confirmed for Gunlance and Switch Axe F) despite being "Gunner"-adjacent
  in some classification systems.

## Category tags (mirrors armor's `CLASS` almost exactly, but as readable text)

Found in a `<p>` element inside the Name cell (absent = normal weapon). Full
census from the Great Sword base page (1,812 rows):

| Tag | Count | Likely armor `CLASS` equivalent |
|---|---|---|
| *(none)* | 1,030 | `""` (normal) |
| 準G級武器 (Semi-G-rank Weapon) | 220 | — (no clean armor equivalent found yet) |
| HC武器 (HC Weapon) | 201 | `E` (ＨＣ) |
| 辿異武器 (Tan'i/**Zenith** Weapon) | 120 | `P`/`Q` (辿異) |
| 親方印 ("Master's Seal") | 45 | — (no clean armor equivalent found yet) |
| 剛種武器 (Goushu Weapon) | 51 | `B` (剛種) |
| 遷悠武器 (Sen'yuu Weapon) | 36 | `O` (遷悠) |
| G級覇種 (G-rank Hashu) | 20 | `G` (G覇種) |
| 覇種武器 (Hashu Weapon) | 20 | `D` (覇種) |
| 天嵐武器 (Tenran Weapon) | 20 | `C` (天嵐) |
| 祈歌武器 ("Prayer Song Weapon") | 18 | — (no clean armor equivalent found yet) |
| 烈種武器 (Resshu Weapon) | 14 | `H` (烈種) |
| 始種武器 (Shishu Weapon) | 9 | `M` (始種) |
| **天廊武器 (Tenrou/Tower Weapon)** | 8 | `N` (天廊) |

Two tags (準G級武器, 親方印, 祈歌武器 — three, actually) have no obvious
armor-side equivalent; may be weapon-specific tiers, or may map to armor
tags not yet seen in our (currently partial) armor `CLASS` census. Not
resolved.

**Confirmed exactly like armor**: `辿異武器` (Zenith Weapon) correlates
**100%** with the presence of a `<q>Zenith Skill：...</q>` tag in the
Sharpness cell, and — just as important — **no weapon without the tag has
one either** (checked all 1,812 Great Sword rows, zero exceptions in either
direction). Same exact-correlation pattern as armor's `CLASS="P"`/`"Q"` ↔
`Teni`.

The `_s` (Raviente) variant adds its own tag, `≪進化武器≫` ("Evolution
Weapon", struck through in the description rather than a clean `<p>` tag —
not yet confirmed whether `_s` rows also get a `<p>` tag or only this
description-text marker). The `_n` (RNGCat) variant tags with
`RNG Cat Weapon` the same way.

## Open questions / not yet done

- Sharpness bar hex `title` attribute: what it encodes, whether decoding it
  is actually necessary given the `<li>` list is already usable directly.
- HBG's column layout (presumed same as LBG, not checked).
- Tonfa/Magnet Spike's exact layout (presumed melee-shaped like Switch Axe
  F, not checked in detail).
- The 3 unmapped category tags (準G級武器/親方印/祈歌武器).
- Whether `_g`/`_s` rows carry Tower/Zenith tags too, or if those are
  base-tier-only concepts.
- No decision yet on scope: the base tier (15,594 rows, fixed-stat, same
  shape problem as armor) is the tractable, high-value target; `_g`
  (48,350) and `_s` (75,400) are both probabilistic/leveled crafting
  systems — structurally closer to the already-deferred regular Sigil
  system than to anything currently modeled.
