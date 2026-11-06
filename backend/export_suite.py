"""Topology-preserving viewport slices and orientation-aware path FASTA."""
import json
import re
import sqlite3
from .layout_engine import layout_subgraph
from .gfa_parser import cigar_length


def bookmarks(conn: sqlite3.Connection) -> list[dict]:
    total = conn.execute('SELECT max(ref_end) FROM nodes WHERE is_backbone=1').fetchone()[0] or 1
    result = []
    for kind, title, query in [
        ('insertion', '500 bp insertion', "SELECT ref_start,ref_end FROM nodes WHERE is_backbone=0 AND length=500 AND ref_start=ref_end LIMIT 1"),
        ('inversion', 'Inversion loop', "SELECT min(a.ref_start,b.ref_start),max(a.ref_end,b.ref_end) FROM edges e JOIN nodes a ON a.id=e.from_node JOIN nodes b ON b.id=e.to_node WHERE e.sv_type='inversion'"),
        ('bubble', 'SNP alternative bubble', "SELECT ref_start,ref_end FROM nodes WHERE is_backbone=0 AND length=1 AND ref_end-ref_start=1 LIMIT 1"),
    ]:
        row = conn.execute(query).fetchone()
        if row and row[0] is not None:
            margin = 250 if kind != 'bubble' else 60
            result.append(dict(id=kind, title=title, start=max(0,row[0]-margin), end=min(total,row[1]+margin)))
    return result


def export_region(conn: sqlite3.Connection, start: int, end: int, format: str, samples: list[str] | None) -> str:
    graph = layout_subgraph(conn, start, end, 'macro')
    nodes = {n.id: dict(conn.execute('SELECT * FROM nodes WHERE id=?',(n.id,)).fetchone()) for n in graph.nodes}
    available = {t.sample_id for t in graph.tracks}
    if samples is not None and set(samples) - available:
        raise ValueError('Unknown sample selection')
    tracks = [t for t in graph.tracks if samples is None or t.sample_id in samples]
    if samples is not None:
        used = {s.node_id for t in tracks for f in t.fragments for s in f.steps}
        nodes = {k:v for k,v in nodes.items() if k in used}
    edges = [e for e in graph.edges if e.from_node in nodes and e.to_node in nodes]
    if format == 'gfa':
        lines = ['H\tVN:Z:1.1', f'# Reference interval [{start},{end}); full intersecting segments and context endpoints; fragment paths']
        lines += [f"S\t{n['id']}\t{n['seq']}\tLN:i:{n['length']}" for n in nodes.values()]
        lines += [f'L\t{e.from_node}\t{e.from_orn}\t{e.to_node}\t{e.to_orn}\t{e.overlap}' for e in edges]
        for t in tracks:
            for i,f in enumerate(t.fragments):
                steps = ','.join(s.node_id+s.orientation for s in f.steps)
                lines.append(f'P\t{t.sample_id}#fragment{i+1}\t{steps}\t*\tGN:Z:{t.group_name}')
        return '\n'.join(lines)+'\n'
    complement = str.maketrans('ACGTRYMKSWBDHVNacgtrymkswbdhvn','TGCAYRKMSWVHDBNtgcayrkmswvhdbn')
    lines = []
    for t in tracks:
        for i,f in enumerate(t.fragments):
            sequence = ''
            for j,s in enumerate(f.steps):
                seq = nodes[s.node_id]['seq']
                if seq == '*':
                    raise ValueError('Unknown segment sequence; cannot export an exact FASTA')
                if s.orientation == '-':
                    seq = seq.translate(complement)[::-1]
                if j:
                    e = next(e for e in edges if e.id==f.edge_ids[j-1])
                    if not re.fullmatch(r'\d+M',e.overlap):
                        raise ValueError('Exact FASTA currently requires known M-only overlaps')
                    seq = seq[cigar_length(e.overlap):]
                sequence += seq
            lines.append(f'>{t.sample_id}#fragment{i+1} interval={start}-{end} full_segments=true')
            lines.extend(sequence[k:k+80] for k in range(0,len(sequence),80))
    return '\n'.join(lines)+ ('\n' if lines else '')
