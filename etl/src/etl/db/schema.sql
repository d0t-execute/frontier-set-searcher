-- ETL staging schema (see docs/PLAN.md §7). Applied idempotently by
-- etl.db.connection.connect(), so every statement here must be safe to
-- re-run against an existing database.

CREATE TABLE IF NOT EXISTS skill (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    category TEXT
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
    source_url TEXT
);

CREATE TABLE IF NOT EXISTS cuff_skill (
    cuff_id INTEGER NOT NULL REFERENCES cuff (id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skill (id) ON DELETE RESTRICT,
    points INTEGER NOT NULL,
    PRIMARY KEY (cuff_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_slot_type ON equipment (slot_type);
CREATE INDEX IF NOT EXISTS idx_equipment_skill_skill_id ON equipment_skill (skill_id);
CREATE INDEX IF NOT EXISTS idx_decoration_skill_skill_id ON decoration_skill (skill_id);
CREATE INDEX IF NOT EXISTS idx_cuff_skill_skill_id ON cuff_skill (skill_id);
