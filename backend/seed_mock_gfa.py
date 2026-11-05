"""Generate a deterministic 62-node, six-sample GFA and import it."""
import argparse
import json
import random
from pathlib import Path

if __package__:
    from .gfa_parser import parse_gfa
else:
    from gfa_parser import parse_gfa


def generate_gfa(destination: Path) -> None:
    rng = random.Random(20261105)
    sequences = {str(i): ''.join(rng.choices('ACGT', k=1 if i == 10 else 100))
                 for i in range(1, 61)}
    sequences['snp_alt'] = next(base for base in 'ACGT' if base != sequences['10'])
    sequences['ins_500'] = ''.join(rng.choices('ACGT', k=500))
    reference = [(str(i), '+') for i in range(1, 61)]
    snp = [('snp_alt' if n == '10' else n, o) for n, o in reference]
    insertion = reference[:20] + [('ins_500', '+')] + reference[20:]
    deletion = [(n, o) for n, o in reference if not 30 <= int(n) <= 39]
    inversion = reference[:44] + [(str(i), '-') for i in range(49, 44, -1)] + reference[49:]
    combined = []
    for n, o in inversion:
        if 30 <= int(n) <= 39:
            continue
        combined.append(('snp_alt' if n == '10' else n, o))
        if n == '20':
            combined.append(('ins_500', '+'))
    samples = [('GRCh38', 'Control', reference), ('HG002', 'Control', snp),
               ('HG005', 'Case', insertion), ('HG007', 'Case', deletion),
               ('HG011', 'Case', inversion), ('HG020', 'Case', combined)]
    links = set()
    flip = {'+': '-', '-': '+'}
    for _, _, path in samples:
        for (a, ao), (b, bo) in zip(path, path[1:]):
            forward = (a, ao, b, bo)
            reverse = (b, flip[bo], a, flip[ao])
            links.add(min(forward, reverse))
    lines = ['H\tVN:Z:1.1']
    lines += [f'S\t{name}\t{seq}' for name, seq in sequences.items()]
    lines += ['L\t' + '\t'.join(link) + '\t0M' for link in sorted(links)]
    lines += [f'P\t{name}\t' + ','.join(n + o for n, o in path) + f'\t*\tGN:Z:{group}'
              for name, group, path in samples]
    with destination.open('x', encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(lines) + '\n')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parent / 'data')
    args = parser.parse_args()
    folder = args.output_dir.resolve()
    gfa, db = folder / 'sample_pangenome.gfa', folder / 'pangenome.db'
    if gfa.exists() or db.exists():
        parser.error('Output already exists. Choose another --output-dir; existing files are preserved.')
    folder.mkdir(parents=True, exist_ok=True)
    generate_gfa(gfa)
    result = parse_gfa(gfa, db)
    print(json.dumps({'gfa': str(gfa), 'database': str(db), **result}, indent=2))


if __name__ == '__main__':
    main()
