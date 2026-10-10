-- ETL staging schema (see docs/PLAN.md §7). Applied idempotently by
-- etl.db.connection.connect(), so every statement here must be safe to
-- re-run against an existing database.

CREATE TABLE IF NOT EXISTS skill (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    category TEXT
);

-- A skill system entirely separate from `skill` (resolved through TENINAME,
-- not MST_Skill), carried by Zenith/Tan'i equipment (CLASS "P"/"Q") in
-- addition to its normal skills. See docs/data-format-notes.md "Zenith
-- skills". Kept as its own table rather than folded into `skill` because
-- the two are populated from different lookup tables in the source and
-- represent genuinely different game systems.
CREATE TABLE IF NOT EXISTS zenith_skill (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY,
    external_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    slot_type TEXT NOT NULL CHECK (
        slot_type IN ('head', 'chest', 'arms', 'waist', 'legs', 'weapon', 'charm')
    ),
    rarity INTEGER,
    -- Defense and slot count both scale across a piece's forge levels (see
    -- docs/data-format-notes.md); skill points do not, which is why Skill
    -- stays a single fixed value below. We store base (unforged) and max
    -- (fully forged) rather than the full per-level table, since search
    -- queries care about what's achievable, not every intermediate step.
    defense_base INTEGER,
    defense_max INTEGER,
    slot_count_base INTEGER NOT NULL DEFAULT 0,
    slot_count_max INTEGER NOT NULL DEFAULT 0,
    min_hr INTEGER,
    min_gr INTEGER,
    -- Tower armor (CLASS "N") can only take Tower Gems in its slots, and
    -- Tower Gems can only go into Tower armor -- an exclusive-both-ways
    -- compatibility rule, confirmed by the project owner. See
    -- docs/data-format-notes.md "Tower Armor".
    is_tower INTEGER NOT NULL DEFAULT 0,
    zenith_skill_id INTEGER REFERENCES zenith_skill (id) ON DELETE RESTRICT,
    source_url TEXT
);

CREATE TABLE IF NOT EXISTS equipment_skill (
    equipment_id INTEGER NOT NULL REFERENCES equipment (id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skill (id) ON DELETE RESTRICT,
    points INTEGER NOT NULL,
    PRIMARY KEY (equipment_id, skill_id)
);

CREATE TABLE IF NOT EXISTS decoration (
    id INTEGER PRIMARY KEY,
    external_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    slot_size INTEGER NOT NULL CHECK (slot_size BETWEEN 1 AND 3),
    -- Tower Gem (CLASS "N") -- see the matching note on `equipment.is_tower`.
    is_tower INTEGER NOT NULL DEFAULT 0,
    source_url TEXT
);

CREATE TABLE IF NOT EXISTS decoration_skill (
    decoration_id INTEGER NOT NULL REFERENCES decoration (id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skill (id) ON DELETE RESTRICT,
    points INTEGER NOT NULL,
    PRIMARY KEY (decoration_id, skill_id)
);

-- A separate category from Decoration, not a variant of it: cuffs occupy
-- their own "Poogie slot" pool (at most 2 equipped, slot costs summing to at
-- most 2), entirely independent of armor decoration sockets. See
-- docs/data-format-notes.md "Cuffs". slot_size 0 is valid and common (Hiden
-- Cuffs, which cost no Poogie-slot capacity), unlike Decoration's 1-3.
CREATE TABLE IF NOT EXISTS cuff (
    id INTEGER PRIMARY KEY,
    external_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    slot_size INTEGER NOT NULL CHECK (slot_size BETWEEN 0 AND 2),
    -- Zenith Cuffs (DEC "3" + CLASS "P") carry only a Zenith skill, no
    -- normal skills -- see docs/data-format-notes.md "Cuffs".
    zenith_skill_id INTEGER REFERENCES zenith_skill (id) ON DELETE RESTRICT,
    source_url TEXT
);

CREATE TABLE IF NOT EXISTS cuff_skill (
    cuff_id INTEGER NOT NULL REFERENCES cuff (id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skill (id) ON DELETE RESTRICT,
    points INTEGER NOT NULL,
    PRIMARY KEY (cuff_id, skill_id)
);

-- Weapons generally don't matter to the set searcher except for slot_count
-- (decos/sigils) and an optional Zenith skill -- confirmed by the project
-- owner. Unlike Equipment, there's no normal-skill join table: weapons never
-- carry normal skills, only an optional Zenith skill. See
-- docs/weapon-data-format-notes.md.
CREATE TABLE IF NOT EXISTS weapon (
    id INTEGER PRIMARY KEY,
    external_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    weapon_type TEXT NOT NULL CHECK (
        weapon_type IN (
            'great_sword', 'long_sword', 'sword_and_shield', 'dual_swords',
            'hammer', 'hunting_horn', 'lance', 'gunlance', 'tonfa',
            'switch_axe_f', 'magnet_spike', 'light_bowgun', 'heavy_bowgun', 'bow'
        )
    ),
    rarity INTEGER,
    slot_count INTEGER NOT NULL DEFAULT 0,
    -- The source gives rank as readable type+number text (e.g. "HR1",
    -- "GR200") rather than armor's single HR1 field, and weapons span four
    -- rank types (HR/SR/GR/GSR) vs. armor's two -- so this is stored as a
    -- type+value pair instead of reusing Equipment's min_hr/min_gr shape.
    rank_type TEXT CHECK (rank_type IN ('HR', 'SR', 'GR', 'GSR')),
    rank_value INTEGER,
    -- Tower weapon (category tag 天廊武器) -- see the matching note on
    -- `equipment.is_tower`.
    is_tower INTEGER NOT NULL DEFAULT 0,
    zenith_skill_id INTEGER REFERENCES zenith_skill (id) ON DELETE RESTRICT,
    source_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_equipment_slot_type ON equipment (slot_type);
CREATE INDEX IF NOT EXISTS idx_equipment_skill_skill_id ON equipment_skill (skill_id);
CREATE INDEX IF NOT EXISTS idx_decoration_skill_skill_id ON decoration_skill (skill_id);
CREATE INDEX IF NOT EXISTS idx_cuff_skill_skill_id ON cuff_skill (skill_id);
CREATE INDEX IF NOT EXISTS idx_equipment_zenith_skill_id ON equipment (zenith_skill_id);
CREATE INDEX IF NOT EXISTS idx_cuff_zenith_skill_id ON cuff (zenith_skill_id);
CREATE INDEX IF NOT EXISTS idx_weapon_weapon_type ON weapon (weapon_type);
CREATE INDEX IF NOT EXISTS idx_weapon_zenith_skill_id ON weapon (zenith_skill_id);
