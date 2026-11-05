"""Run from repository root: python -m unittest backend.test_data_layer -v."""
import json
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from .database import connect, query_region
from .gfa_parser import parse_gfa
from .seed_mock_gfa import generate_gfa


class DataLayerTests(unittest.TestCase):
    # Keep fixtures on disk: workspace policy requires approval before file deletion.
    def setUp(self):
        root = Path(__file__).resolve().parent / '.test-runs'
        root.mkdir(exist_ok=True)
        self.folder = Path(tempfile.mkdtemp(prefix='pangenome_step1_', dir=root))

    def import_text(self, text):
        source, db = self.folder / 'input.gfa', self.folder / 'graph.db'
        source.write_text(text, encoding='utf-8')
        result = parse_gfa(source, db)
        return result, connect(db)

    def test_mock_variants_and_index(self):
        source, db = self.folder / 'sample.gfa', self.folder / 'graph.db'
        generate_gfa(source)
        result = parse_gfa(source, db)
        self.assertEqual((result['nodes'], result['paths'], result['backbone_nodes']), (62, 6, 60))
        self.assertEqual(result['reference_length'], 5901)
        self.assertEqual(result['anchored_nodes'], 62)
        self.assertEqual(set(result['edge_types']), {'normal', 'insertion', 'deletion', 'inversion'})
        self.assertEqual(result['edge_types'], {'normal': 61, 'insertion': 2, 'deletion': 1, 'inversion': 2})
        with closing(connect(db)) as conn:
            self.assertEqual(conn.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(conn.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertEqual(conn.execute("SELECT length FROM nodes WHERE id='ins_500'").fetchone()[0], 500)
            self.assertEqual({r['id'] for r in query_region(conn, 900, 901)}, {'10', 'snp_alt'})
            self.assertIn('ins_500', {r['id'] for r in query_region(conn, 1901, 1902)})
            self.assertNotIn('ins_500', {r['id'] for r in query_region(conn, 1900, 1901)})
            path = json.loads(conn.execute("SELECT node_path FROM paths WHERE sample_id='HG011'").fetchone()[0])
            self.assertEqual([s['node_id'] for s in path if s['orientation'] == '-'], ['49','48','47','46','45'])
            plan = conn.execute('EXPLAIN QUERY PLAN SELECT * FROM node_intervals WHERE start < 100 AND end >= 0').fetchall()
            self.assertTrue(any('VIRTUAL TABLE INDEX' in row[3] for row in plan))
        with self.assertRaisesRegex(ValueError, 'not empty'):
            parse_gfa(source, db)

    def test_multihop_and_disconnected(self):
        result, conn = self.import_text('S\ta\tAAAA\nS\tb\tCCCC\nS\tx\tG\nS\ty\tT\nS\tz\t*\tLN:i:7\nL\ta\t+\tb\t+\t0M\nL\ta\t+\tx\t+\t0M\nL\tx\t+\ty\t+\t0M\nL\ty\t+\tb\t+\t0M\nP\tref\ta+,b+\t*\n')
        try:
            self.assertEqual(result['anchored_nodes'], 4)
            self.assertEqual({r['id'] for r in query_region(conn, 4, 5)}, {'b', 'x', 'y'})
            self.assertIsNone(conn.execute("SELECT ref_start FROM nodes WHERE id='z'").fetchone()[0])
        finally:
            conn.close()

    def test_reverse_reference_and_overlap(self):
        result, conn = self.import_text('H\tVN:Z:1.0\nS\ta\tAAAA\nS\tb\tTTTT\nL\tb\t+\ta\t+\t2M\nP\tref\ta-,b-\t*\n')
        try:
            self.assertEqual(result['reference_length'], 6)
            self.assertEqual(conn.execute("SELECT ref_start FROM nodes WHERE id='b'").fetchone()[0], 2)
        finally:
            conn.close()

    def test_missing_segment_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unknown segment'):
            self.import_text('S\ta\tA\nP\tref\ta+,missing+\t*\n')

    def test_repeated_reference_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Repeated reference'):
            self.import_text('S\ta\tA\nL\ta\t+\ta\t+\t0M\nP\tref\ta+,a+\t*\n')


if __name__ == '__main__':
    unittest.main()
