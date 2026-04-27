# Paper Sync CLI Guide

Stage 1 simplifies the sync command into a strict, non-interactive interface.

## Command Shape

```bash
python main.py (--strapi-people | --institution INSTITUTION | --person PERSON_NAME) [--dry-run]
```

## Default Behavior

Running `python main.py --strapi-people` now always:

1. loads Strapi people
2. resolves each person against OpenAlex
3. fetches and deduplicates papers
4. updates/creates publications in Strapi
5. rebuilds graph links and graph metadata from all graph-eligible publications

The run is deterministic and low-config:

- source selection is explicit and strict (`--strapi-people`, `--institution`, or `--person`)
- OpenAlex fetch cache reuse is always enabled
- refresh-cache, local file mode, and interactive prompts are removed from the CLI surface
- updates for existing machine-managed publications are always enabled

## Options

### `--strapi-people`

Import based only on people loaded from Strapi.

### `--institution`

Import works for one OpenAlex institution.

Institution name for institution-based import.

### `--person`

Import works for one OpenAlex author resolved by person name.

Person name is required for single-person import.

Validation rules:

- one of `--strapi-people`, `--institution`, or `--person` is required
- they are mutually exclusive

If no source selector is provided, the CLI prints help and exits without running.
Any other invalid invocation still hard-fails.

### `--dry-run`

Skips Strapi writes.

The tool still performs fetch + graph computation and writes local debug artifacts in `outputs/`.

## Examples

Run the full Strapi-people sync:

```bash
python main.py --strapi-people
```

Run institution-wide sync:

```bash
python main.py --institution "Technical University of Cluj-Napoca"
```

Run non-writing dry run in Strapi-people mode:

```bash
python main.py --strapi-people --dry-run
```

Run non-writing dry run in institution mode:

```bash
python main.py --institution "Technical University of Cluj-Napoca" --dry-run
```

Run single-person import:

```bash
python main.py --person "Adrian Groza"
```

## Quality Artifacts

Each run now writes quality diagnostics in `research-paper-graph/outputs/`.

- `quality_<label>.json`: macro/meso quality metrics, label alignment score, and tuning hints
- `topic_hierarchy_<label>.json`: topic superclusters plus per-paper supercluster assignments
- `communities_<label>.json`: community assignments and labels

Use these files to compare parameter profiles without changing code.

## Tuning Knobs (.env)

- `GRAPH_HDBSCAN_MIN_CLUSTER_SIZE`
- `GRAPH_HDBSCAN_MIN_SAMPLES`
- `GRAPH_SECONDARY_CLUSTER_DISTANCE_THRESHOLD`
- `GRAPH_TOPIC_HDBSCAN_MIN_CLUSTER_SIZE`
- `GRAPH_TOPIC_HDBSCAN_MIN_SAMPLES`
- `GRAPH_MESO_MIN_NODE_PAPERS`
- `GRAPH_MESO_MAX_NODES`
- `GRAPH_MESO_MIN_NODES`

Suggested target:

- macro clusters: `6-10`
- meso nodes per macro: `8-20`

## Parameter Sweep Helper

Use the helper script to generate or run matrix sweeps:

```bash
# Print commands only
scripts/paper-graph-sweep.sh

# Execute commands
scripts/paper-graph-sweep.sh --run

# Execute on one person slice
scripts/paper-graph-sweep.sh --run --source "--person Adrian Groza"
```
