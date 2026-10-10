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
    defense INTEGER,
    slot_count INTEGER NOT NULL DEFAULT 0,
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

CREATE INDEX IF NOT EXISTS idx_equipment_slot_type ON equipment (slot_type);
CREATE INDEX IF NOT EXISTS idx_equipment_skill_skill_id ON equipment_skill (skill_id);
CREATE INDEX IF NOT EXISTS idx_decoration_skill_skill_id ON decoration_skill (skill_id);
