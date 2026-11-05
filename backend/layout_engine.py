"""Deterministic local tube layout with orientation-aware sample geometry."""
import json
import math
import sqlite3
from collections import Counter, defaultdict, deque

from .database import query_region
from .schemas import GenomeMeta, LOD, Subgraph


class LayoutTooLarge(ValueError):
    """The requested viewport exceeds the synchronous layout budget."""


def genome_meta(conn: sqlite3.Connection) -> GenomeMeta:
    samples = [dict(r) for r in conn.execute('SELECT sample_id,group_name FROM paths ORDER BY sample_id')]
    groups = defaultdict(list)
    for sample in samples:
        groups[sample['group_name']].append(sample['sample_id'])
    return GenomeMeta(
        total_length=conn.execute('SELECT coalesce(max(ref_end),0) FROM nodes WHERE is_backbone=1').fetchone()[0],
        node_count=conn.execute('SELECT count(*) FROM nodes').fetchone()[0],
        edge_count=conn.execute('SELECT count(*) FROM edges').fetchone()[0],
        samples=samples, groups=dict(groups),
    )


def cubic(a, b, direction_a=1, direction_b=1) -> dict:
    handle = max(12.0, abs(b[0] - a[0]) / 3)
    return dict(x1=a[0], y1=a[1], cp1x=a[0] + direction_a * handle, cp1y=a[1],
                cp2x=b[0] - direction_b * handle, cp2y=b[1], x2=b[0], y2=b[1])


def reverse_segments(segments: list[dict]) -> list[dict]:
    return [dict(x1=s['x2'], y1=s['y2'], cp1x=s['cp2x'], cp1y=s['cp2y'],
                 cp2x=s['cp1x'], cp2y=s['cp1y'], x2=s['x1'], y2=s['y1'])
            for s in reversed(segments)]


def layout_subgraph(conn: sqlite3.Connection, start_pos: int, end_pos: int,
                    lod_level: LOD = 'macro', max_nodes: int = 5000) -> Subgraph:
    if lod_level not in ('macro', 'micro'):
        raise ValueError('lod must be macro or micro')
    hits = query_region(conn, start_pos, end_pos)
    selected = {n['id']: n for n in hits}
    original_ids = set(selected)
    if len(selected) > max_nodes:
        raise LayoutTooLarge('Too many nodes; narrow the query interval')

    # Cross-window deletion/inversion links must remain visible even if neither
    # endpoint overlaps the viewport. UNION also preserves the indexed hit query.
    edge_rows = conn.execute('''
        SELECT e.* FROM edges e JOIN nodes a ON a.id=e.from_node JOIN nodes b ON b.id=e.to_node
        WHERE e.sv_type IN ('deletion','inversion')
          AND min(a.ref_start,b.ref_start) < ? AND max(a.ref_end,b.ref_end) > ?
        UNION
        SELECT e.* FROM edges e WHERE e.from_node IN (
            SELECT n.id FROM node_intervals r JOIN nodes n ON n.rowid=r.node_rowid
            WHERE r.start < ? AND r.end >= ? AND (n.ref_end > ? OR n.ref_start=n.ref_end)
        ) OR e.to_node IN (
            SELECT n.id FROM node_intervals r JOIN nodes n ON n.rowid=r.node_rowid
            WHERE r.start < ? AND r.end >= ? AND (n.ref_end > ? OR n.ref_start=n.ref_end)
        ) ORDER BY id
    ''', (end_pos, start_pos, end_pos, start_pos, start_pos, end_pos, start_pos, start_pos))
    edges = [dict(r) for r in edge_rows]
    endpoint_ids = {e[k] for e in edges for k in ('from_node', 'to_node')}
    for name in sorted(endpoint_ids - set(selected)):
        selected[name] = dict(conn.execute('SELECT * FROM nodes WHERE id=?', (name,)).fetchone())
    if len(selected) > max_nodes:
        raise LayoutTooLarge('Too many context nodes; narrow the query interval')
    # Include all induced links between the selected endpoints, without creating
    # a SQL IN list that could exceed SQLite's parameter limit.
    known_edges = {e['id'] for e in edges}
    for name in sorted(selected):
        for row in conn.execute('SELECT * FROM edges WHERE from_node=?', (name,)):
            if row['to_node'] in selected and row['id'] not in known_edges:
                edges.append(dict(row))
                known_edges.add(row['id'])
    edges.sort(key=lambda e: e['id'])
    path_rows = [dict(r) for r in conn.execute('SELECT * FROM paths ORDER BY sample_id')]
    paths = {r['sample_id']: json.loads(r['node_path']) for r in path_rows}
    count = len(paths)
    offsets = {name: (i - (count - 1) / 2) * 6.0 for i, name in enumerate(paths)}
    memberships = defaultdict(set)
    for sample, steps in paths.items():
        for step in steps:
            if step['node_id'] in selected:
                memberships[step['node_id']].add(sample)

    # Step 1 stores the reference embedding but not its name/orientation. Recover
    # orientations from a complete, monotonic all-backbone path when available.
    reference_orientation = {}
    backbone_info = {r['id']: dict(r) for r in conn.execute(
        'SELECT id,ref_start,ref_end FROM nodes WHERE is_backbone=1')}
    for steps in paths.values():
        ids = [s['node_id'] for s in steps]
        if len(ids) == len(backbone_info) and len(set(ids)) == len(ids) and set(ids) == set(backbone_info):
            starts = [backbone_info[n]['ref_start'] for n in ids]
            if starts == sorted(starts):
                reference_orientation = {s['node_id']: s['orientation'] for s in steps}
                break

    def width(n):
        return max(24.0, n['length'] * 0.8) if lod_level == 'micro' else 24.0 + 24.0 * math.log10(max(1, n['length']))

    band_height = max(18.0, (count - 1) * 6.0 + 12.0)
    lane_gap = band_height + 36.0
    backbone = sorted((n for n in selected.values() if n['is_backbone']), key=lambda n: (n['ref_start'], n['id']))
    cursor = 40.0
    for n in backbone:
        n.update(x=cursor, y=0.0, width=width(n), track_slot=0, topology_depth=0)
        cursor += n['width'] + 40.0

    def project(position):
        if not backbone:
            return 40.0 + (position - start_pos) * (0.8 if lod_level == 'micro' else 0.3)
        for n in backbone:
            if position <= n['ref_end']:
                fraction = (position - n['ref_start']) / max(1, n['ref_end'] - n['ref_start'])
                return n['x'] + fraction * n['width']
        n = backbone[-1]
        return n['x'] + n['width'] + (position - n['ref_end']) * 0.3

    adjacency = defaultdict(set)
    inversion_nodes = set()
    for e in edges:
        a, b = e['from_node'], e['to_node']
        adjacency[a].add(b)
        adjacency[b].add(a)
        if e['sv_type'] == 'inversion':
            inversion_nodes.update((a, b))
    # Multi-source BFS gives finite topology depths even in cyclic components.
    depths = {n['id']: 0 for n in backbone}
    queue = deque(depths)
    while queue:
        a = queue.popleft()
        for b in sorted(adjacency[a]):
            if b not in depths:
                depths[b] = depths[a] + 1
                queue.append(b)
    reservations = defaultdict(list)

    def reserve(left, right, minimum=1, side=1):
        lane = max(1, minimum)
        while any(left < b + 16 and right + 16 > a for a, b in reservations[side * lane]):
            lane += 1
        reservations[side * lane].append((left, right))
        return side * lane

    branches = sorted((n for n in selected.values() if not n['is_backbone']),
                      key=lambda n: (depths.get(n['id'], 1), n['ref_start'], n['id']))
    for n in branches:
        w = width(n)
        x = project((n['ref_start'] + n['ref_end']) / 2) - w / 2
        depth = depths.get(n['id'], 1)
        # Negative slots are above the backbone; inversion branches are below.
        slot = reserve(x, x + w, depth, 1 if n['id'] in inversion_nodes else -1)
        n.update(x=x, y=slot * lane_gap, width=w, track_slot=slot, topology_depth=depth)

    for n in selected.values():
        n.update(height=band_height, context_only=n['id'] not in original_ids,
                 reference_orientation=reference_orientation.get(n['id'], '+'),
                 sequence=n['seq'] if lod_level == 'micro' else None,
                 tracks=[dict(sample_id=s, offset_y=offsets[s]) for s in sorted(memberships[n['id']])])

    def port(name, orn, outgoing):
        n = selected[name]
        direction = 1 if orn == n['reference_orientation'] else -1
        right = (direction == 1) == outgoing
        return (n['x'] + (n['width'] if right else 0), n['y']), direction

    edge_lookup = {}
    flip = {'+': '-', '-': '+'}
    for e in edges:
        a, da = port(e['from_node'], e['from_orn'], True)
        b, db = port(e['to_node'], e['to_orn'], False)
        if e['sv_type'] in ('deletion', 'inversion'):
            left, right = min(a[0], b[0]), max(a[0], b[0])
            minimum = max(1, math.ceil(max(a[1], b[1]) / lane_gap) + 1)
            slot = reserve(left - 30, right + 30, minimum, 1)
            y = slot * lane_gap
            p, q = (a[0] + da * 30, y), (b[0] - db * 30, y)
            middle_direction = 1 if q[0] >= p[0] else -1
            e['segments'] = [cubic(a, p, da, middle_direction),
                             cubic(p, q, middle_direction, middle_direction),
                             cubic(q, b, middle_direction, db)]
        else:
            e['segments'] = [cubic(a, b, da, db)]
        e['sample_ids'] = []
        key = (e['from_node'], e['from_orn'], e['to_node'], e['to_orn'])
        edge_lookup.setdefault(key, (e, False))
        edge_lookup.setdefault((key[2], flip[key[3]], key[0], flip[key[1]]), (e, True))

    tracks = []
    for row in path_rows:
        sample = row['sample_id']
        fragments, fragment = [], None
        previous = None
        for i, step in enumerate(paths[sample]):
            name, orn = step['node_id'], step['orientation']
            if name not in selected:
                fragment, previous = None, None
                continue
            connection = None if previous is None else edge_lookup.get((*previous, name, orn))
            if fragment is None or connection is None:
                fragment = dict(steps=[], edge_ids=[], segments=[])
                fragments.append(fragment)
            else:
                e, reverse = connection
                if sample not in e['sample_ids']:
                    e['sample_ids'].append(sample)
                fragment['edge_ids'].append(e['id'])
                curves = reverse_segments(e['segments']) if reverse else e['segments']
                fragment['segments'].extend([
                    {k: v + offsets[sample] if k in ('y1', 'cp1y', 'cp2y', 'y2') else v for k, v in curve.items()}
                    for curve in curves])
            incoming, direction = port(name, orn, False)
            outgoing, _ = port(name, orn, True)
            fragment['segments'].append(cubic((incoming[0], incoming[1] + offsets[sample]),
                                              (outgoing[0], outgoing[1] + offsets[sample]), direction, direction))
            fragment['steps'].append(dict(**step, path_index=i))
            previous = (name, orn)
        tracks.append(dict(sample_id=sample, group_name=row['group_name'], offset_y=offsets[sample], fragments=fragments))

    # Components are counted only when they contain a viewport hit, not context.
    remaining = {n['id'] for n in branches}
    snps = insertions = replacements = 0
    while remaining:
        root = min(remaining)
        component, stack = {root}, [root]
        remaining.remove(root)
        while stack:
            for b in adjacency[stack.pop()]:
                if b in remaining:
                    remaining.remove(b)
                    component.add(b)
                    stack.append(b)
        if not component & original_ids:
            continue
        component_nodes = [selected[n] for n in component]
        if all(n['ref_start'] == n['ref_end'] for n in component_nodes):
            insertions += 1
        elif len(component_nodes) == 1 and component_nodes[0]['length'] == 1 and component_nodes[0]['ref_end'] - component_nodes[0]['ref_start'] == 1:
            snps += 1
        else:
            replacements += 1
    def overlaps_viewport(e):
        a, b = selected[e['from_node']], selected[e['to_node']]
        return (e['from_node'] in original_ids or e['to_node'] in original_ids or
                (e['sv_type'] in ('deletion', 'inversion') and
                 min(a['ref_start'], b['ref_start']) < end_pos and
                 max(a['ref_end'], b['ref_end']) > start_pos))

    relevant = [e for e in edges if overlaps_viewport(e)]
    edge_counts = {kind: 0 for kind in ('normal', 'insertion', 'deletion', 'inversion')}
    edge_counts.update(Counter(e['sv_type'] for e in relevant))
    xs, ys = [0.0], [0.0]
    for n in selected.values():
        xs.extend((n['x'], n['x'] + n['width']))
        ys.extend((n['y'] - band_height / 2, n['y'] + band_height / 2))
    # Bezier curves lie within the convex hull of their control points.
    for segments in ([e['segments'] for e in edges] +
                     [f['segments'] for t in tracks for f in t['fragments']]):
        for c in segments:
            xs.extend(c[k] for k in ('x1', 'cp1x', 'cp2x', 'x2'))
            ys.extend(c[k] for k in ('y1', 'cp1y', 'cp2y', 'y2'))
    return Subgraph(start=start_pos, end=end_pos, lod=lod_level,
                    nodes=[selected[k] for k in sorted(selected)], edges=edges, tracks=tracks,
                    summary=dict(snp_bubbles=snps, insertion_components=insertions,
                                 replacement_components=replacements,
                                 deletion_edges=edge_counts['deletion'], inversion_edges=edge_counts['inversion'],
                                 edge_counts=edge_counts),
                    bounds=dict(min_x=min(xs) - 20, min_y=min(ys) - 20,
                                max_x=max(xs) + 20, max_y=max(ys) + 20))
