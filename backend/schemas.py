"""Typed rendering contract. Coordinates are pixels, +Y points downward."""
from typing import Literal

from pydantic import BaseModel

LOD = Literal['macro', 'micro']
Orientation = Literal['+', '-']
SVType = Literal['normal', 'insertion', 'deletion', 'inversion']


class Bezier(BaseModel):
    x1: float
    y1: float
    cp1x: float
    cp1y: float
    cp2x: float
    cp2y: float
    x2: float
    y2: float


class Sample(BaseModel):
    sample_id: str
    group_name: str


class GenomeMeta(BaseModel):
    coordinate_system: str = '0-based-half-open'
    total_length: int
    node_count: int
    edge_count: int
    samples: list[Sample]
    groups: dict[str, list[str]]


class NodeTrack(BaseModel):
    sample_id: str
    offset_y: float


class LayoutNode(BaseModel):
    id: str
    length: int
    is_backbone: bool
    ref_start: int | None
    ref_end: int | None
    context_only: bool
    x: float
    y: float
    width: float
    height: float
    track_slot: int
    topology_depth: int
    reference_orientation: Orientation
    sequence: str | None
    tracks: list[NodeTrack]


class LayoutEdge(BaseModel):
    id: int
    from_node: str
    from_orn: Orientation
    to_node: str
    to_orn: Orientation
    sv_type: SVType
    overlap: str
    sample_ids: list[str]
    segments: list[Bezier]


class PathStep(BaseModel):
    node_id: str
    orientation: Orientation
    path_index: int


class TrackFragment(BaseModel):
    steps: list[PathStep]
    edge_ids: list[int]
    segments: list[Bezier]


class HaplotypeTrack(Sample):
    offset_y: float
    fragments: list[TrackFragment]


class VariantSummary(BaseModel):
    snp_bubbles: int
    insertion_components: int
    replacement_components: int
    deletion_edges: int
    inversion_edges: int
    edge_counts: dict[str, int]
    counting_method: str = 'topology-components-and-edges; not phased biological event counts'


class Bounds(BaseModel):
    min_x: float
    min_y: float
    max_x: float
    max_y: float


class Subgraph(BaseModel):
    start: int
    end: int
    lod: LOD
    coordinate_system: str = '0-based-half-open'
    nodes: list[LayoutNode]
    edges: list[LayoutEdge]
    tracks: list[HaplotypeTrack]
    summary: VariantSummary
    bounds: Bounds
