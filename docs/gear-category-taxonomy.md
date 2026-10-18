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

## Tree 1: Equipment

### Paid and Premium

**Update (2026-10-18):** each of the 5 routes below splits further by CLASS (confirmed against the
real dataset, via `_paid_premium_subcategory` in gear_category.py) -- a complete partition, not a
guess: every route's own sub-counts sum exactly to its un-split total. Name-suffix tokens (HS/GS,GP/
HC/ZP) corroborate each CLASS value but aren't needed to decide the leaf. "G-Shugo" merges 2 real,
evenly-split, name-suffix variants ("GS"/"GP") that share one CLASS value -- both are `TYPE=0` (not a
Blademaster/Gunner pair), so what actually distinguishes them in-game is unconfirmed; kept as one leaf
rather than guessing a further split.

| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| Package | `CRE=5p`, `CLASS ""` (base) | 1,334 | HIGH |
| Package HS | `CRE=5p` + `CLASS F` | 440 | HIGH |
| Package G-Shugo | `CRE=5p` + `CLASS J` ("GS"/"GP") | 800 | HIGH |
| Package HC | `CRE=5p` + `CLASS E` | 80 | HIGH |
| Premium Kit | `CRE=4k`, `CLASS ""` (base) | 9,882 | HIGH |
| Premium Kit HS | `CRE=4k` + `CLASS F` | 3,262 | HIGH |
| Premium Kit G-Shugo | `CRE=4k` + `CLASS J` | 6,524 | HIGH |
| Premium Kit HC | `CRE=4k` + `CLASS E` | 1,201 | HIGH |
| Premium Kit ZP | `CRE=4k` + `CLASS Q` | 864 | HIGH |
| Gachapon | `CRE=4g`, `CLASS ""` (base) | 6,223 | HIGH |
| Gachapon HS | `CRE=4g` + `CLASS F` | 1,626 | HIGH |
| Gachapon G-Shugo | `CRE=4g` + `CLASS J` | 3,312 | HIGH |
| Gachapon HC | `CRE=4g` + `CLASS E` | 20 | HIGH |
| Gachapon ZP | `CRE=4g` + `CLASS Q` | 1,056 | HIGH |
| Gachapon Hiden | `CRE=4g` + `CLASS K` | 420 | HIGH |
| Gachapon G-Hiden | `CRE=4g` + `CLASS L` | 840 | HIGH |
| Gachapon Exotic | `CRE=4g` + `CLASS O` | 248 | HIGH |
| Net Cafe | `CRE=3-`/`3e`, `CLASS ""` (base) | 569 | HIGH |
| Net Cafe HS | `CRE=3-`/`3e` + `CLASS F` | 126 | HIGH |
| Net Cafe G-Shugo | `CRE=3-`/`3e` + `CLASS J` | 252 | HIGH |
| Net Cafe HC | `CRE=3-`/`3e` + `CLASS E` | 22 | HIGH |
| Net Cafe ZP | `CRE=3-`/`3e` + `CLASS Q` | 30 | HIGH |
| Promotional | `CRE=5-`, `CLASS ""` (base) | 1,026 | HIGH |
| Promotional HS | `CRE=5-` + `CLASS F` | 230 | HIGH |
| Promotional G-Shugo | `CRE=5-` + `CLASS J` | 433 | HIGH |
| Promotional HC | `CRE=5-` + `CLASS E` | 72 | HIGH |
| Promotional ZP | `CRE=5-` + `CLASS Q` | 50 | HIGH |
| Subscription Period | *(no leaf — confirmed empty)* | 0 | CONFIRMED |
| Taiwanese Premium | *(no leaf — confirmed empty)* | 0 | CONFIRMED |

### Guild
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| Festival | `CRE=2m`, excluding FX-suffix rows (→ FX bucket) | 2,508 | HIGH |
| 猟 (plain) | `CRE=2-`, no suffix / F / FY / SP | 284 | HIGH |
| 猟HS | `CRE=2-` + `CLASS F` | 10 | HIGH |
| 猟G | `CRE=2-` + `CLASS I/J` + G/GF | 114 | HIGH |
| 猟GX | `CRE=2-` + GX suffix | 57 | HIGH |

### Diva Defense
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| Diva Defense | `CRE=2u` (Guild+Interception) | 410 (400 `CLASS P` Zenith "Diva" family + 10 `CLASS I` GX "Burning Cliff") | CONFIRMED (user: "guild -> diva defense") |

### Tower
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 塔 (plain) | `CRE=1t` + `CLASS N`, no suffix | 180 | HIGH |
| 塔HS | `CRE=1t` + `CLASS N` + HS | 60 | HIGH |
| 塔G | `CRE=1t` + `CLASS N` + G/GF | 120 | HIGH |
| 刻GX (Customisable Tower GX) | `CRE=1t` + `CLASS N` + GX suffix | 60 (all TYPE variants) | HIGH — confirmed via user screenshots of the actual item names (Cleora/Keisu/Lumiere/Nyui/Once/Ranvuo, all 5 slots) |
| 刻 (Customisable Tower, non-GX) | — | 0 armor rows found | UNRESOLVED — no armor data matches; presumed weapons-only unless you have an example |

### Caravan and Diva Battle (航)
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 航 | `CRE=1c` (R/L) + `CRE=1s` (plain/F/FY) | 250 | INFERRED |
| 航RX | `CRE=1c` + RX | 5 | INFERRED |
| 航HS | `CRE=1s` + `CLASS F` | 80 | INFERRED |
| 航G | `CRE=1s` + `CLASS I` + G/GF | 160 | INFERRED |
| 航GX | `CRE=1s` + GX | 80 | INFERRED |

### Hunter's Road (道)
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 道 (plain) | `CRE=1t`, not `CLASS N`/`P` | 165 | HIGH |
| 道HS | `CRE=1t` + `CLASS F` | 55 | HIGH |
| 道G | `CRE=1t` + `CLASS I` + G/GF | 110 | HIGH |
| 道GX | `CRE=1t` + `CLASS I` + GX | 55 + 100 (Nympha/Will/Saint/White Fatalis GX) = **155** | HIGH — confirmed "just road's gx tier" |
| 道辿 (Road Zenith) | `CRE=1t` + `CLASS P` | 120 | HIGH |
| 道辿ZY | `CRE=1t` + `CLASS P` + ZY | 60 | HIGH |
| 道辿ZX | `CRE=1t` + `CLASS P` + ZX | 60 | HIGH |

### G Rank Armour
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| G | `CRE=1-` + `CLASS I` + G/GF | 1,918 | HIGH |
| GX | `CRE=1-` + `CLASS I` + GX | 959 | HIGH |
| G覇 (G Supremacy) | `CLASS G` | 270 | HIGH — same kanji ("覇") as `CLASS D`'s "Supremacy" below, just the G-rank tier; label corrected 2026-10-18 from the un-translated "G-Hashu" for consistency |
| ? (CLASS H / 烈種, label unconfirmed) | `CLASS H` | 270 | **Label needs your confirmation** — I don't actually know the reference tool's name for this leaf; "刻祕" (my earlier guess) doesn't fit the kanji and was never verified, same mistake pattern as "皇GX" turned out to be. The CLASS→270-row match itself is solid; only the display label is in question. |
| G祕 | `CLASS L` | 840 | HIGH |
| 始 (Sisyu/Origin) | `CLASS M` | 200 | HIGH |
| 縁 (Exotic) | `CLASS O`, non-GX | 330 | HIGH |
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
| 祕 (Hiden) | `CLASS K` | 420 | HIGH |

### HR100~
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| FX | plain class + FX suffix, `CRE` in {1-, 1e, 2m} | 282 | HIGH |
| 凱 (Gou) | `CLASS B` | 260 | INFERRED (270/270 match ≪剛種防具≫; glyph is 凱, not 剛) |

### Event Armour (イ)
**Update (2026-10-18)**: per the project owner's redone schema (docs/skill-system-roadmap.md TODO
#38), this bucket now splits by GX tier (previously one flat leaf for both, confirmed HIGH against
the real dataset but not matching the reference tool's own tree, which does split it) and has Musou
and Extreme Quest armor carved out of it by curated name, the same way decorations already carve
Musou out of their own Event bucket. No separate "Event G" leaf exists (G/GF-tier non-curated rows
stay in the plain bucket, matching the reference tool's own 2-leaf "イ/イGX" shape, not decorations'
3-leaf one).
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| イ | `CRE=1e`, excluding Zenith/FX/Mystery/Musou/Extreme, G/GF-tier or non-G-rank | 2,442 | HIGH |
| イGX | `CRE=1e` + `CLASS I` + GX, excluding Musou/Extreme | 288 | HIGH |
| イ辿 | `CRE=1e` + `CLASS P` | 104 | HIGH |
| イ辿ZY | `CRE=1e` + `CLASS P` + ZY | 52 | HIGH |
| イ辿ZX | `CRE=1e` + `CLASS P` + ZX | 52 | HIGH |
| 謎 (Mystery Quest Armour) | `Luxt` series, GX tier, all 5 slots × all TYPE variants | 10 | CONFIRMED |
| 衛 (Hunting Tournament) | `CRE=1i` | 42 | HIGH |
| 衛HC | `CRE=1i` + `CLASS E` | 10 | HIGH |
| 衛HS | `CRE=1i` + `CLASS F` | 13 | HIGH |
| 衛G | `CRE=1i` + G/GF | 20 | HIGH |
| 衛GX | `CRE=1i` + GX | 10 | HIGH |
| 衛GP | `CRE=1i` + `CLASS J` | 6 | HIGH |
| 衛ZP | `CRE=1i` + `CLASS Q` | 3 | HIGH |

### Musou Armour (CRE=1e + CLASS=I, carved out of Event Armour by name)
Confirmed by the project owner (2026-10-18) against the real armor names for all 9 Musou-tier
monsters -- CRE/CLASS alone can't distinguish these from any other Event-GX armor, same situation the
matching Musou *decorations* were already in. Unlike the decorations (which use a distinct "<name>
GX1".."GX5" naming scheme per monster and always share one leaf across both hunter-type names), Musou
ARMOR only has a genuine two-name split for 2 of the 9 monsters; the armor name itself also differs
from the decoration name for 3 monsters (noted below).
| Leaf | Monster | Armor name(s) | Count | Confidence |
|---|---|---|---|---|
| `event_musou_nargacuga` | Nargacuga | Demonclad (1 name, common to both hunter types) | 15 | CONFIRMED |
| `event_musou_guanzorumu` | Guanzorumu | 鬼凛ノ / 童凛ノ (2 names) | 30 | CONFIRMED |
| `event_musou_bogabadorumu` | Bogabadorumu | Rapin (deco name is "Rafan" instead) | 30 | CONFIRMED |
| `event_musou_zinogre` | Zinogre | Chiru | 30 | CONFIRMED |
| `event_musou_zerureusu` | Zerureusu | Elysi (deco name is "Elysium" instead) | 30 | CONFIRMED |
| `event_musou_elzelion` | Elzelion | Fonse (deco name is "Fonce" instead) | 30 | CONFIRMED |
| `event_musou_miru` | Mi Ru | Demon Tale / 童伝ノ (2 names) | 30 | CONFIRMED |
| `event_musou_pariapuria` | Pariapuria | Ganeto | 30 | CONFIRMED |
| `event_musou_duremudira` | Duremudira | Bonne (same name as its decoration) | 30 | CONFIRMED |

Row counts above are mostly 30 (not 15) because most of these monsters still use the project's
general Mail/Vest-style per-slot Blademaster/Gunner name pair (e.g. "Rapin G Helm"/"Rapin G Cap") --
same category either way, per this doc's own general rule above. Nargacuga is the outlier with one
bare name per slot (no Helm/Cap-style pair), hence only 15.

### Extreme Quest Armour (CRE=1e + CLASS=I, carved out of Event Armour by name)
Confirmed by the project owner (2026-10-18): 4 distinct quest rewards, none tied to an actual Musou
monster (the reference tool's own tree calls this "EXd"/Extreme Quests, previously deferred for
decorations -- see docs/skill-system-roadmap.md TODO #38/#39 history).
| Leaf | Names | Shape | Count | Confidence |
|---|---|---|---|---|
| `event_extreme_demon_lord` | Demon Lord / 童子ノ | full 5-slot set, 2 hunter-type-flavored names | 30 | CONFIRMED |
| `event_extreme_heruto` | Heruto | head-only, no other-slot counterpart | 3 | CONFIRMED |
| `event_extreme_iroasu` | Iroasu | head-only | 3 | CONFIRMED |
| `event_extreme_luchar` | Luchar | head-only | 3 | CONFIRMED |

**Correction (2026-10-18)**: Raviente-named armor was initially suspected to exist inside `grank_gx`
("Violent Ravi"/"Berserk Ravi"/"Extreme Ravi" BM/GN GX1-GX5) -- re-verified by tracking which
`SkillForm.setEquip("<slot>", ...)` section each row actually lives in, and all of those rows are in
the `"deco"` section, not real armor. They're the already-fully-implemented Raviente *decorations*
(`deco_raviente`/`deco_extreme_raviente` below) -- no Raviente armor exists at all, `grank_gx` was
never actually affected.

### Standard Armour
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 無分類 | `CRE=1-`, plain class | 3,064 | HIGH |
| SP | `CLASS A` | 881 | HIGH |

### Unavailable
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
| ガG祕 (Lottery Hiden, "do not use") | `deco_lottery_hiden` | `CRE=4g` + `CLASS L` "Hiden EX" | 56 | HIGH |
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
