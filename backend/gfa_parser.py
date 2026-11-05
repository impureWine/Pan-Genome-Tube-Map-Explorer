"""Strict GFA 1.0/1.1 S/L/P importer; no external Python dependencies."""
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

if __package__:
    from .database import connect, initialize, statistics
else:
    from database import connect, initialize, statistics


def cigar_length(cigar: str, reverse: bool = False) -> int:
    if cigar == '*':
        raise ValueError('Unknown overlap cannot determine backbone coordinates')
    if not re.fullmatch(r'(\d+[MIDNSHPX=])+', cigar):
        raise ValueError(f'Invalid overlap CIGAR: {cigar}')
    operations = 'MDN=X' if reverse else 'MIS=X'
    return sum(int(n) for n, op in re.findall(r'(\d+)([MIDNSHPX=])', cigar) if op in operations)


def parse_gfa(source: str | Path, database: str | Path, reference: str | None = None) -> dict:
    nodes, edges, paths = {}, [], {}
    flip = {'+': '-', '-': '+'}
    with Path(source).open(encoding='utf-8') as handle:
        for number, raw in enumerate(handle, 1):
            if not raw.strip() or raw.startswith('#'):
                continue
            fields = raw.rstrip('\r\n').split('\t')
            try:
                kind = fields[0]
                if kind == 'H':
                    versions = [v[5:] for v in fields[1:] if v.startswith('VN:Z:')]
                    if versions and versions[0] not in ('1.0', '1.1'):
                        raise ValueError('Only GFA 1.0 and 1.1 are supported')
                elif kind == 'S':
                    name, seq = fields[1:3]
                    if not name or name in nodes:
                        raise ValueError('Empty or duplicate segment ID')
                    lengths = [int(t[5:]) for t in fields[3:] if t.startswith('LN:i:')]
                    if seq == '*' and not lengths:
                        raise ValueError('S sequence * requires LN:i:length')
                    length = lengths[0] if seq == '*' else len(seq)
                    if length < 0 or (lengths and lengths[0] != length):
                        raise ValueError('Invalid or inconsistent segment length')
                    nodes[name] = dict(id=name, seq=seq, length=length,
                                       is_backbone=0, ref_start=None, ref_end=None)
                elif kind == 'L':
                    a, ao, b, bo, overlap = fields[1:6]
                    if ao not in flip or bo not in flip:
                        raise ValueError('Invalid link orientation')
                    if overlap != '*':
                        cigar_length(overlap)
                    edges.append((a, ao, b, bo, overlap))
                elif kind == 'P':
                    name, steps, overlaps = fields[1:4]
                    if name in paths or not name or steps == '*':
                        raise ValueError('Duplicate/empty path or missing steps')
                    tokens = steps.split(',')
                    if any(len(t) < 2 or t[-1] not in flip for t in tokens):
                        raise ValueError('Invalid path step')
                    path = [(t[:-1], t[-1]) for t in tokens]
                    ov = None if overlaps == '*' else overlaps.split(',')
                    if ov is not None and len(ov) != len(path) - 1:
                        raise ValueError('Path overlap count must equal step count minus one')
                    group = next((t[5:] for t in fields[4:] if t.startswith('GN:Z:')), 'Unknown')
                    paths[name] = (path, ov, group)
                else:
                    raise ValueError(f'Unsupported record {kind}; expected H/S/L/P')
            except (ValueError, IndexError) as exc:
                raise ValueError(f'{source}:{number}: {exc}') from exc
    if not nodes or not paths:
        raise ValueError('At least one segment and one path are required')
    links = defaultdict(list)
    adjacency = defaultdict(set)
    for a, ao, b, bo, overlap in edges:
        if a not in nodes or b not in nodes:
            raise ValueError(f'Link references unknown segment: {a}, {b}')
        links[(a, ao, b, bo)].append((overlap, False))
        links[(b, flip[bo], a, flip[ao])].append((overlap, True))
        adjacency[a].add(b)
        adjacency[b].add(a)
    for name, (path, overlaps, _) in paths.items():
        if any(n not in nodes for n, _ in path):
            raise ValueError(f'Path {name} references unknown segment')
        for i, (left, right) in enumerate(zip(path, path[1:])):
            if (*left, *right) not in links:
                raise ValueError(f'Path {name} has no link: {left} -> {right}')
            if overlaps is not None and overlaps[i] != '*':
                cigar_length(overlaps[i])
    ref = reference if reference is not None else next(iter(paths))
    if ref not in paths:
        raise ValueError(f'Reference path not found: {ref}')
    backbone, overlaps, _ = paths[ref]
    if len({n for n, _ in backbone}) != len(backbone):
        raise ValueError('Repeated reference segments cannot have a single reference interval')
    cursor = 0
    reference_edges = set()
    ref_orientation = dict(backbone)
    for i, (name, orn) in enumerate(backbone):
        consumed = 0
        if i:
            a, ao = backbone[i - 1]
            reference_edges.add((a, ao, name, orn))
            reference_edges.add((name, flip[orn], a, flip[ao]))
            if overlaps is not None and overlaps[i - 1] != '*':
                consumed = cigar_length(overlaps[i - 1])
            else:
                choices = {cigar_length(c, reverse) for c, reverse in links[(a, ao, name, orn)]}
                if len(choices) != 1:
                    raise ValueError('Ambiguous reference overlap')
                consumed = choices.pop()
            if consumed > min(nodes[a]['length'], nodes[name]['length']):
                raise ValueError('Reference overlap exceeds segment length')
        start = cursor - consumed
        cursor = start + nodes[name]['length']
        if cursor > 2147483647:
            raise ValueError('Reference exceeds rtree_i32 coordinate range')
        nodes[name].update(is_backbone=1, ref_start=start, ref_end=cursor)
    unseen = {n for n in nodes if not nodes[n]['is_backbone']}
    while unseen:
        root = unseen.pop()
        component, anchors, stack = {root}, set(), [root]
        while stack:
            for neighbor in adjacency[stack.pop()]:
                if nodes[neighbor]['is_backbone']:
                    anchors.add(neighbor)
                elif neighbor in unseen:
                    unseen.remove(neighbor)
                    component.add(neighbor)
                    stack.append(neighbor)
        if anchors:
            ordered = sorted(anchors, key=lambda n: nodes[n]['ref_start'])
            if len(ordered) == 1:
                start, end = nodes[ordered[0]]['ref_start'], nodes[ordered[0]]['ref_end']
            else:
                start, end = nodes[ordered[0]]['ref_end'], nodes[ordered[-1]]['ref_start']
                start, end = min(start, end), max(start, end)
            for name in component:
                nodes[name].update(ref_start=start, ref_end=end)

    def classify(a, ao, b, bo):
        if (a, ao, b, bo) in reference_edges:
            return 'normal'
        # An L record and its reverse complement describe the same physical edge.
        # Normalize using the first reference endpoint before classifying it.
        pivot = (a, ao) if a in ref_orientation else (b, bo)
        if pivot[0] in ref_orientation and pivot[1] != ref_orientation[pivot[0]]:
            a, ao, b, bo = b, flip[bo], a, flip[ao]
        na, nb = nodes[a], nodes[b]
        if any(n in ref_orientation and o != ref_orientation[n] for n, o in ((a, ao), (b, bo))):
            return 'inversion'
        if any(not n['is_backbone'] and n['ref_start'] is not None
               and n['ref_start'] == n['ref_end'] for n in (na, nb)):
            return 'insertion'
        if na['is_backbone'] and nb['is_backbone']:
            if nb['ref_start'] > na['ref_end']:
                return 'deletion'
            if nb['ref_start'] < na['ref_start']:
                return 'inversion'
        return 'normal'

    conn = connect(database)
    try:
        initialize(conn)
        with conn:
            if conn.execute('SELECT EXISTS(SELECT 1 FROM nodes)').fetchone()[0] or conn.execute('SELECT EXISTS(SELECT 1 FROM paths)').fetchone()[0]:
                raise ValueError('Destination database is not empty; choose a new filename')
            conn.executemany('INSERT INTO nodes VALUES(:id,:seq,:length,:is_backbone,:ref_start,:ref_end)', nodes.values())
            conn.executemany('INSERT INTO edges(from_node,from_orn,to_node,to_orn,overlap,sv_type) VALUES(?,?,?,?,?,?)',
                             [(*e, classify(*e[:4])) for e in edges])
            conn.executemany('INSERT INTO paths VALUES(?,?,?)',
                             [(name, group, json.dumps([{'node_id': n, 'orientation': o} for n, o in path]))
                              for name, (path, _, group) in paths.items()])
        return {'reference': ref, 'reference_length': cursor, **statistics(conn)}
    finally:
        conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('gfa', type=Path)
    parser.add_argument('database', type=Path)
    parser.add_argument('--reference')
    args = parser.parse_args()
    print(json.dumps(parse_gfa(args.gfa, args.database, args.reference), indent=2))
