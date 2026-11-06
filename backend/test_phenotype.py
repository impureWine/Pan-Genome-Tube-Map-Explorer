import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from .main import create_app


class PhenotypeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app(Path(__file__).parent / 'data' / 'pangenome.db'))

    def tearDown(self):
        self.client.close()

    def test_insertion_frequencies(self):
        response = self.client.get('/api/nodes/ins_500')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['length'], 500)
        self.assertEqual(len(data['seq']), 500)
        self.assertEqual(data['groups']['Case'], {'carriers': 2, 'total': 4, 'frequency': .5})
        self.assertEqual(data['groups']['Control']['frequency'], 0)
        self.assertEqual({s['sample_id'] for s in data['samples']}, {'HG005', 'HG020'})
        self.assertIn('SIMULATED', data['annotation']['source'])

    def test_snp_distinct_carriers(self):
        data = self.client.get('/api/nodes/snp_alt').json()
        self.assertEqual(data['groups']['Case']['frequency'], .25)
        self.assertEqual(data['groups']['Control']['frequency'], .5)

    def test_missing_node(self):
        self.assertEqual(self.client.get('/api/nodes/no-such-node').status_code, 404)


if __name__ == '__main__':
    unittest.main()
