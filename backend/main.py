"""Run: python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .layout_engine import LayoutTooLarge, genome_meta, layout_subgraph
from .schemas import GenomeMeta, LOD, Subgraph
from .phenotype import node_details
from .export_suite import bookmarks, export_region
from fastapi.responses import Response


def create_app(database_path: str | Path | None = None) -> FastAPI:
    application = FastAPI(title='Pan-Genome Tube Map Explorer', version='0.2.0')
    application.state.database_path = Path(database_path or os.environ.get(
        'PANGENOME_DB', str(Path(__file__).resolve().parent / 'data' / 'pangenome.db'))).resolve()
    origins = [s.strip() for s in os.environ.get(
        'CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(',') if s.strip()]
    application.add_middleware(CORSMiddleware, allow_origins=origins,
                               allow_credentials=False, allow_methods=['GET'], allow_headers=['*'])

    @contextmanager
    def database():
        conn = None
        try:
            # Read-only URI: a typo in the database path never creates an empty DB.
            conn = sqlite3.connect(application.state.database_path.as_uri() + '?mode=ro', uri=True)
            conn.row_factory = sqlite3.Row
            conn.execute('BEGIN')
            yield conn
        except sqlite3.Error as exc:
            raise HTTPException(503, 'Genome database is unavailable or incompatible; check PANGENOME_DB') from exc
        finally:
            if conn is not None:
                conn.close()

    @application.get('/api/genome/meta', response_model=GenomeMeta)
    def meta():
        with database() as conn:
            return genome_meta(conn)

    @application.get('/api/subgraph', response_model=Subgraph)
    def subgraph(start: int = Query(ge=0, le=2147483646),
                 end: int = Query(gt=0, le=2147483647), lod: LOD = 'macro'):
        if end <= start:
            raise HTTPException(422, 'end must be greater than start (0-based half-open interval)')
        with database() as conn:
            try:
                return layout_subgraph(conn, start, end, lod)
            except LayoutTooLarge as exc:
                raise HTTPException(413, str(exc)) from exc

    @application.get('/api/nodes/{node_id:path}')
    def inspect_node(node_id: str):
        with database() as conn:
            result = node_details(conn, node_id)
            if result is None:
                raise HTTPException(404, 'Node not found')
            return result

    @application.get('/api/bookmarks')
    def presets():
        with database() as conn:
            return bookmarks(conn)

    @application.get('/api/export')
    def export(start: int = Query(ge=0), end: int = Query(gt=0, le=2147483647),
               format: str = Query(pattern='^(gfa|fasta)$'), sample: list[str] | None = Query(default=None)):
        if start >= end:
            raise HTTPException(422, 'end must be greater than start')
        with database() as conn:
            try:
                content = export_region(conn,start,end,format,sample)
            except (ValueError, LayoutTooLarge) as exc:
                raise HTTPException(422,str(exc)) from exc
        return Response(content,media_type='text/plain',headers={
            'Content-Disposition': f'attachment; filename="pangenome-{start}-{end}.{format}"'})

    return application


app = create_app()
