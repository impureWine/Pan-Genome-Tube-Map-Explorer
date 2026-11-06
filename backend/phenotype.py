"""Distinct sample-path carrier frequencies; not diploid genotype AF."""
import json
import sqlite3


def node_details(conn: sqlite3.Connection, node_id: str) -> dict | None:
    row = conn.execute('SELECT * FROM nodes WHERE id=?', (node_id,)).fetchone()
    if row is None:
        return None
    node = dict(row)
    samples, groups = [], {}
    for path in conn.execute('SELECT * FROM paths ORDER BY sample_id'):
        group = groups.setdefault(path['group_name'], {'total': 0, 'carriers': 0})
        group['total'] += 1
        if any(s['node_id'] == node_id for s in json.loads(path['node_path'])):
            samples.append({'sample_id': path['sample_id'], 'group_name': path['group_name']})
            group['carriers'] += 1
    for group in groups.values():
        group['frequency'] = group['carriers'] / group['total'] if group['total'] else None
    node.update(samples=samples, groups=groups,
                annotation={'source': 'SIMULATED — demo annotation, not a genomic database match',
                            'gene': 'DEMO_SV_LOCUS',
                            'function': 'Synthetic locus for testing structural-variant inspection.',
                            'consequence': 'Reference segment' if node['is_backbone'] else 'Simulated alternative segment; functional effect unvalidated'},
                frequency_definition='Distinct sample paths containing node / all sample paths in group; not genotype allele frequency')
    return node
