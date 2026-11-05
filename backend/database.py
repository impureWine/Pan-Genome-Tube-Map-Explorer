"""SQLite storage and exact integer interval queries (0-based, half-open)."""
import sqlite3
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY, seq TEXT NOT NULL, length INTEGER NOT NULL CHECK(length >= 0),
    is_backbone INTEGER NOT NULL CHECK(is_backbone IN (0,1)),
    ref_start INTEGER, ref_end INTEGER,
    CHECK ((ref_start IS NULL AND ref_end IS NULL) OR
           (ref_start >= 0 AND ref_end >= ref_start AND ref_end <= 2147483647))
);
CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY, from_node TEXT NOT NULL REFERENCES nodes(id),
    from_orn TEXT NOT NULL CHECK(from_orn IN ('+','-')),
    to_node TEXT NOT NULL REFERENCES nodes(id),
    to_orn TEXT NOT NULL CHECK(to_orn IN ('+','-')), overlap TEXT NOT NULL,
    sv_type TEXT NOT NULL CHECK(sv_type IN ('normal','insertion','deletion','inversion'))
);
CREATE TABLE IF NOT EXISTS paths (
    sample_id TEXT PRIMARY KEY, group_name TEXT NOT NULL, node_path TEXT NOT NULL
    CHECK(json_valid(node_path) AND json_type(node_path) = 'array')
);
CREATE INDEX IF NOT EXISTS nodes_ref_start ON nodes(ref_start);
CREATE INDEX IF NOT EXISTS nodes_ref_end ON nodes(ref_end);
CREATE INDEX IF NOT EXISTS edges_from ON edges(from_node);
CREATE INDEX IF NOT EXISTS edges_to ON edges(to_node);
CREATE VIRTUAL TABLE IF NOT EXISTS node_intervals USING rtree_i32(node_rowid, start, end);
CREATE TRIGGER IF NOT EXISTS nodes_interval_insert AFTER INSERT ON nodes
WHEN NEW.ref_start IS NOT NULL BEGIN
    INSERT INTO node_intervals VALUES(NEW.rowid, NEW.ref_start, NEW.ref_end);
END;
CREATE TRIGGER IF NOT EXISTS nodes_interval_update AFTER UPDATE ON nodes BEGIN
    DELETE FROM node_intervals WHERE node_rowid=OLD.rowid;
    INSERT INTO node_intervals SELECT NEW.rowid, NEW.ref_start, NEW.ref_end
    WHERE NEW.ref_start IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS nodes_interval_delete AFTER DELETE ON nodes BEGIN
    DELETE FROM node_intervals WHERE node_rowid=OLD.rowid;
END;
"""


def connect(database: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(database))
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def initialize(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def query_region(conn: sqlite3.Connection, start: int, end: int) -> list[dict]:
    """Return interval hits; zero-length insertions hit when start <= point < end."""
    if not 0 <= start < end <= 2147483647:
        raise ValueError('Expected 0 <= start < end <= 2147483647')
    rows = conn.execute('''
        SELECT n.* FROM node_intervals r JOIN nodes n ON n.rowid=r.node_rowid
        WHERE r.start < ? AND r.end >= ?
          AND (n.ref_end > ? OR n.ref_start = n.ref_end)
        ORDER BY n.ref_start, n.id
    ''', (end, start, start))
    return [dict(row) for row in rows]


def statistics(conn: sqlite3.Connection) -> dict:
    return {
        'nodes': conn.execute('SELECT count(*) FROM nodes').fetchone()[0],
        'edges': conn.execute('SELECT count(*) FROM edges').fetchone()[0],
        'paths': conn.execute('SELECT count(*) FROM paths').fetchone()[0],
        'backbone_nodes': conn.execute('SELECT count(*) FROM nodes WHERE is_backbone=1').fetchone()[0],
        'anchored_nodes': conn.execute('SELECT count(*) FROM node_intervals').fetchone()[0],
        'edge_types': dict(conn.execute('SELECT sv_type, count(*) FROM edges GROUP BY sv_type')),
    }
