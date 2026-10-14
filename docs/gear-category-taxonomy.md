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
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| Package | `CRE=5p` | 2,654 | HIGH |
| Premium Kit | `CRE=4k` | 21,733 | HIGH |
| Gachapon | `CRE=4g` | 13,745 | HIGH |
| Net Cafe | `CRE=3-` or `CRE=3e` | 999 | HIGH |
| Promotional | `CRE=5-` | 1,811 | HIGH |
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
| G覇 (G-Hashu) | `CLASS G` | 270 | HIGH |
| ? (CLASS H / 烈種, label unconfirmed) | `CLASS H` | 270 | **Label needs your confirmation** — I don't actually know the reference tool's name for this leaf; "刻祕" (my earlier guess) doesn't fit the kanji and was never verified, same mistake pattern as "皇GX" turned out to be. The CLASS→270-row match itself is solid; only the display label is in question. |
| G祕 | `CLASS L` | 840 | HIGH |
| 始 (Sisyu/Origin) | `CLASS M` | 200 | HIGH |
| 縁 (Exotic) | `CLASS O`, non-GX | 330 | HIGH |
| 縁GX | `CLASS O` + GX | 110 | HIGH |

### Zenith Armour
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 辿 | `CRE=1-` + `CLASS P` | 460 | HIGH |
| 辿ZY | `CRE=1-` + `CLASS P` + ZY | 230 | HIGH |
| 辿ZX | `CRE=1-` + `CLASS P` + ZX | 230 | HIGH |

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
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| イ | `CRE=1e`, excluding Zenith/FX/Mystery | 3,024 − 10 (Luxt GX → 謎) = **3,014** | HIGH |
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
all 18 leaves matched this table's counts exactly (3,332 cuffs total), so
every "INFERRED" tag below should be read as re-confirmed, not just
originally plausible. Decorations are NOT classified by this function yet
(out of scope for the cuff-support work that prompted this verification
pass) -- the "Decorations" tree further below remains undocumented-only.
Display labels for cuff leaves still haven't been confirmed against the
reference tool's own tree (unlike every equipment leaf above) -- the
`cuff_*` category keys are correct and already usable for filtering, but
treat their eventual UI label as open.

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
| S_辿 (Zenith) | `CRE=1-` + `CLASS P` "SZ" (26) + `DEC=3` + `CLASS P` "Sigil" (26) | 52 | HIGH |
| S_未 | `CRE=9` + S name | 45 | HIGH |
| S_不 | `CRE=7-` ("Guild R. Cuff") | 12 | INFERRED |
| 祕 (Hiden Cuff) | `CRE=1-` + `CLASS L` | 140 | HIGH |

### Decorations
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| 無分類 | `CRE=1-`, plain | 271 | HIGH |
| SP改 | `CLASS A` "SP α" | 43 | HIGH |
| SP真 | `CLASS A` "SP β" | 43 | HIGH |
| G | `CRE=1-` + `CLASS I` + G/GF | 360 | HIGH |
| GX | `CRE=1-` + `CLASS I` + GX | 842 | HIGH |
| G祕 | `CRE=1-` + `CLASS L` "Hiden?" | 56 | HIGH |
| 真G祕 | `CRE=1-` + `CLASS L` "True?" | 56 | HIGH |
| 蛇GX (Raviente Decorations) | Raviente / Violent Raviente / Berserk Raviente GX | 30 | CONFIRMED |
| 極蛇GX (Extreme Raviente Decorations) | Extreme Raviente GX | 10 | CONFIRMED |
| イ (Event) | `CRE=1e`, plain class | 49 | HIGH |
| イG | `CRE=1e` + G/GF | 6 | INFERRED |
| イGX | `CRE=1e` + GX | 93 | INFERRED |
| Festival | `CRE=2m` | 421 | HIGH |
| 猟G | `CRE=2-` + G/GF | 8 | HIGH |
| 猟GX | `CRE=2-` + GX | 20 | HIGH |
| Diva Defense | `CRE=2u` | 10 | INFERRED |
| 道 (Road) | `CRE=1t`, plain | 3 | HIGH |
| 道GX (Road GX) | `CRE=1t` + `CLASS I` | 40 | CONFIRMED — "just road's gx tier" |
| ｶﾞG祕 | `CRE=4g` + `CLASS L` "Hiden EX" | 56 | HIGH |
| ｶﾞ | `CRE=4k` (4) + `CRE=5-` (1) | 5 | INFERRED |
| ｶﾞTW | *(no leaf — confirmed empty)* | 0 | CONFIRMED |

### Unavailable
| Leaf | Rule | Count | Confidence |
|---|---|---|---|
| カフ | `CRE=7-` | 12 | HIGH |
| 不 | `CRE=9`, recipe 作成不可 | 3 | HIGH |
| 未 | `CRE=9`, HR 10000 | 5 | INFERRED |

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
