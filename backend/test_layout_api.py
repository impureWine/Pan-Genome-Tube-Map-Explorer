"""Geometry invariants and HTTP contract tests; no fixture files are deleted."""
import json
import sqlite3
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from .database import connect, initialize
from .layout_engine import LayoutTooLarge, layout_subgraph
from .main import create_app

DATABASE = Path(__file__).resolve().parent / 'data' / 'pangenome.db'


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.conn = connect(DATABASE)

    def tearDown(self):
        self.conn.close()

    def test_full_geometry_and_node_collision(self):
        graph = layout_subgraph(self.conn, 0, 5901, 'micro')
        self.assertEqual((len(graph.nodes), len(graph.edges), len(graph.tracks)), (62, 66, 6))
        for node in graph.nodes:
            if node.is_backbone:
                self.assertEqual(node.y, 0)
            else:
                self.assertLess(node.y, 0)
        for i, a in enumerate(graph.nodes):
            for b in graph.nodes[i + 1:]:
                overlap_x = a.x < b.x + b.width and b.x < a.x + a.width
                overlap_y = abs(a.y - b.y) < (a.height + b.height) / 2
                self.assertFalse(overlap_x and overlap_y, (a.id, b.id))
        for edge in graph.edges:
            for curve in edge.segments:
                self.assertEqual(curve.y1, curve.cp1y)
                self.assertEqual(curve.y2, curve.cp2y)
            if edge.sv_type in ('deletion', 'inversion'):
                self.assertEqual(len(edge.segments), 3)
                self.assertGreater(edge.segments[1].y1, 0)
        self.assertEqual(graph.summary.snp_bubbles, 1)
        self.assertEqual(graph.summary.insertion_components, 1)
        self.assertEqual(graph.summary.deletion_edges, 1)
        self.assertEqual(graph.summary.inversion_edges, 2)

    def test_track_continuity_offsets_and_reverse_ports(self):
        graph = layout_subgraph(self.conn, 0, 5901)
        nodes = {n.id: n for n in graph.nodes}
        offsets = [t.offset_y for t in graph.tracks]
        self.assertTrue(all(b - a == 6 for a, b in zip(offsets, offsets[1:])))
        for track in graph.tracks:
            self.assertEqual(len(track.fragments), 1)
            for fragment in track.fragments:
                for a, b in zip(fragment.segments, fragment.segments[1:]):
                    self.assertEqual((a.x2, a.y2), (b.x1, b.y1))
            for node in nodes.values():
                for lane in node.tracks:
                    if lane.sample_id == track.sample_id:
                        self.assertEqual(lane.offset_y, track.offset_y)
        inversion = next(t for t in graph.tracks if t.sample_id == 'HG011')
        reverse_steps = [s for f in inversion.fragments for s in f.steps if s.orientation == '-']
        self.assertEqual([s.node_id for s in reverse_steps], ['49', '48', '47', '46', '45'])

    def test_cross_window_deletion_and_fragment_gaps(self):
        graph = layout_subgraph(self.conn, 3200, 3300)
        deletion = next(e for e in graph.edges if e.sv_type == 'deletion')
        nodes = {n.id: n for n in graph.nodes}
        self.assertTrue(nodes[deletion.from_node].context_only)
        self.assertTrue(nodes[deletion.to_node].context_only)
        hg007 = next(t for t in graph.tracks if t.sample_id == 'HG007')
        self.assertIn(deletion.id, [e for f in hg007.fragments for e in f.edge_ids])
        reference = next(t for t in graph.tracks if t.sample_id == 'GRCh38')
        self.assertGreater(len(reference.fragments), 1)
        for fragment in reference.fragments:
            indices = [s.path_index for s in fragment.steps]
            self.assertTrue(all(b == a + 1 for a, b in zip(indices, indices[1:])))

    def test_lod_empty_and_determinism(self):
        macro = layout_subgraph(self.conn, 1800, 2000, 'macro')
        micro = layout_subgraph(self.conn, 1800, 2000, 'micro')
        self.assertTrue(all(n.sequence is None for n in macro.nodes))
        self.assertTrue(all(n.sequence is not None for n in micro.nodes))
        self.assertGreater(next(n.width for n in micro.nodes if n.id == 'ins_500'),
                           next(n.width for n in macro.nodes if n.id == 'ins_500'))
        self.assertEqual(macro.model_dump(), layout_subgraph(self.conn, 1800, 2000).model_dump())
        empty = layout_subgraph(self.conn, 9000, 9100)
        self.assertEqual((empty.nodes, empty.edges), ([], []))
        self.assertTrue(all(t.fragments == [] for t in empty.tracks))
        with self.assertRaises(LayoutTooLarge):
            layout_subgraph(self.conn, 0, 5901, max_nodes=10)

    def test_cyclic_branch_finite_depth_and_collision(self):
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        try:
            initialize(conn)
            conn.executemany('INSERT INTO nodes VALUES(?,?,?,?,?,?)', [
                ('a', 'AAAA', 4, 1, 0, 4), ('b', 'CCCC', 4, 1, 4, 8),
                ('x', 'G', 1, 0, 4, 4), ('y', 'T', 1, 0, 4, 4),
            ])
            conn.executemany('INSERT INTO edges(from_node,from_orn,to_node,to_orn,overlap,sv_type) VALUES(?,?,?,?,?,?)', [
                ('a','+','b','+','0M','normal'), ('a','+','x','+','0M','insertion'),
                ('x','+','y','+','0M','insertion'), ('y','+','x','+','0M','insertion'),
                ('y','+','b','+','0M','insertion'),
            ])
            conn.execute('INSERT INTO paths VALUES(?,?,?)', ('ref','Control',json.dumps([
                dict(node_id='a',orientation='+'),dict(node_id='b',orientation='+') ])))
            graph = layout_subgraph(conn, 0, 8)
            branches = [n for n in graph.nodes if not n.is_backbone]
            self.assertEqual(len({n.track_slot for n in branches}), 2)
            self.assertTrue(all(0 < n.topology_depth < 4 for n in branches))
        finally:
            conn.close()


class APITests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app(DATABASE))

    def tearDown(self):
        self.client.close()

    def test_meta_and_subgraph(self):
        meta = self.client.get('/api/genome/meta')
        self.assertEqual(meta.status_code, 200)
        self.assertEqual(meta.json()['total_length'], 5901)
        self.assertEqual(len(meta.json()['samples']), 6)
        self.assertEqual({k: len(v) for k, v in meta.json()['groups'].items()}, {'Control': 2, 'Case': 4})
        response = self.client.get('/api/subgraph', params=dict(start=900, end=901, lod='micro'))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['summary']['snp_bubbles'], 1)
        self.assertIn('snp_alt', [n['id'] for n in body['nodes']])

    def test_validation_and_cors(self):
        for params in ({'start':-1,'end':100}, {'start':1,'end':1}, {'start':2,'end':1},
                       {'start':0,'end':100,'lod':'bad'}, {'start':'x','end':100},
                       {'start':0,'end':2147483648}, {}):
            self.assertEqual(self.client.get('/api/subgraph', params=params).status_code, 422)
        response = self.client.options('/api/subgraph', headers={
            'Origin':'http://localhost:3000','Access-Control-Request-Method':'GET'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['access-control-allow-origin'], 'http://localhost:3000')
        forbidden = self.client.options('/api/subgraph', headers={
            'Origin':'https://unlisted.example','Access-Control-Request-Method':'GET'})
        self.assertNotIn('access-control-allow-origin', forbidden.headers)

    def test_missing_database_is_503_without_creation(self):
        path = DATABASE.parent / 'missing-test-database.db'
        self.assertFalse(path.exists())
        with TestClient(create_app(path)) as client:
            self.assertEqual(client.get('/api/genome/meta').status_code, 503)
            self.assertEqual(client.get('/api/subgraph?start=0&end=100').status_code, 503)
        self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main()
