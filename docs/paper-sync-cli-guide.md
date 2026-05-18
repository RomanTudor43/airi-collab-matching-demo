# Paper Sync CLI Guide

Stage 1 simplifies the sync command into a strict, non-interactive interface.

## Command Shape

```bash
python main.py [--institution INSTITUTION | --person PERSON_NAME]
```

If no source is specified, defaults to **Strapi people** mode.

## Default Behavior

Running `python main.py` (no arguments) always:

1. loads Strapi people
2. resolves each person against OpenAlex
3. fetches and deduplicates papers
4. updates/creates publications in Strapi
5. rebuilds graph links and graph metadata from all graph-eligible publications

The run is deterministic and low-config:

- default source is Strapi people (no flag needed)
- optional override flags: `--institution` or `--person` for one-off debugging
- OpenAlex fetch happens live on each execution
- updates for existing machine-managed publications are always enabled

## Options

### `--institution INSTITUTION_NAME`

Optional. Override default Strapi-people mode to import papers for one specific OpenAlex institution.

### `--person PERSON_NAME`

Optional. Override default Strapi-people mode to import papers for one specific OpenAlex author (by name lookup).

**Note:** Only one of `--institution` or `--person` may be provided. If neither is provided, defaults to Strapi-people mode.

## Examples

Run the standard monthly Strapi-people sync (default):

```bash
python main.py
```

Run institution-wide sync (override default):

```bash
python main.py --institution "Technical University of Cluj-Napoca"
```

Run single-person import (override default):

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
