import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from .main import create_app
from .database import connect


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.path=Path(__file__).parent/'data'/'pangenome.db'
        self.client=TestClient(create_app(self.path))

    def tearDown(self):
        self.client.close()

    def test_bookmarks(self):
        data=self.client.get('/api/bookmarks').json()
        self.assertEqual({p['id'] for p in data},{'insertion','inversion','bubble'})
        self.assertTrue(all(0<=p['start']<p['end']<=5901 for p in data))

    def test_gfa_links_and_fragment_paths(self):
        response=self.client.get('/api/export?start=3200&end=3300&format=gfa')
        self.assertEqual(response.status_code,200)
        records=[line.split('\t') for line in response.text.splitlines() if not line.startswith('#')]
        ids={r[1] for r in records if r[0]=='S'}
        self.assertTrue(all(r[1] in ids and r[3] in ids for r in records if r[0]=='L'))
        self.assertTrue(all(s[:-1] in ids for r in records if r[0]=='P' for s in r[2].split(',')))
        self.assertIn('attachment',response.headers['content-disposition'])

    def test_reverse_complement_fasta(self):
        response=self.client.get('/api/export?start=0&end=5901&format=fasta&sample=HG011')
        self.assertEqual(response.status_code,200)
        actual=''.join(response.text.splitlines()[1:])
        conn=connect(self.path)
        try:
            seq={r['id']:r['seq'] for r in conn.execute('SELECT * FROM nodes')}
        finally:
            conn.close()
        complement=str.maketrans('ACGT','TGCA')
        expected=''.join(seq[str(i)] for i in range(1,45))+''.join(seq[str(i)].translate(complement)[::-1] for i in range(49,44,-1))+''.join(seq[str(i)] for i in range(50,61))
        self.assertEqual(actual,expected)

    def test_validation(self):
        for query in ['start=5&end=1&format=gfa','start=0&end=20&format=bad','start=0&end=20&format=fasta&sample=missing']:
            self.assertEqual(self.client.get('/api/export?'+query).status_code,422)


if __name__=='__main__':
    unittest.main()
