export type LOD = "macro" | "micro";
export type LODMode = "auto" | LOD;
export type Region = { start: number; end: number };
export type Variant = "SNP" | "InDel" | "Inversion";
export interface Sample { sample_id: string; group_name: string }
export interface GenomeMeta {
  coordinate_system: string; total_length: number; node_count: number; edge_count: number;
  samples: Sample[]; groups: Record<string, string[]>;
}
export interface Bezier {
  x1: number; y1: number; cp1x: number; cp1y: number;
  cp2x: number; cp2y: number; x2: number; y2: number;
}
export interface LayoutNode {
  id: string; length: number; is_backbone: boolean; ref_start: number | null; ref_end: number | null;
  context_only: boolean; x: number; y: number; width: number; height: number;
  track_slot: number; topology_depth: number; reference_orientation: "+" | "-";
  sequence: string | null; tracks: { sample_id: string; offset_y: number }[];
}
export interface LayoutEdge {
  id: number; from_node: string; to_node: string; from_orn: "+" | "-"; to_orn: "+" | "-";
  sv_type: "normal" | "insertion" | "deletion" | "inversion";
  overlap: string; sample_ids: string[]; segments: Bezier[];
}
export interface Subgraph extends Region {
  lod: LOD; coordinate_system: string; nodes: LayoutNode[]; edges: LayoutEdge[];
  tracks: (Sample & { offset_y: number; fragments: {
    steps: { node_id: string; orientation: "+" | "-"; path_index: number }[];
    edge_ids: number[]; segments: Bezier[];
  }[] })[];
  summary: { snp_bubbles: number; insertion_components: number; replacement_components: number;
    deletion_edges: number; inversion_edges: number; edge_counts: Record<string, number>; counting_method: string };
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
}
