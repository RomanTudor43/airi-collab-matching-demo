"""Locate and expose the sibling ``research-paper-graph`` package.

The existing package is not pip-installable (it is run via ``python main.py``
from inside its own folder), so we add its root directory to ``sys.path`` at
runtime instead of vendoring or forking any of its files.
"""

import sys
from pathlib import Path

# The folder name of the existing package (sibling to this one).
_SIBLING_DIR_NAME = "research-paper-graph"
# The importable package inside that folder.
_INNER_PACKAGE = "research_paper_graph"


def find_research_paper_graph_root():
    """Return the path to the ``research-paper-graph`` folder, or None."""
    here = Path(__file__).resolve()
    # Walk upward from this file; at each ancestor look for the sibling folder.
    for parent in here.parents:
        candidate = parent / _SIBLING_DIR_NAME
        if (candidate / _INNER_PACKAGE / "__init__.py").exists():
            return candidate
    return None


def ensure_research_paper_graph_importable():
    """Insert the existing package's root onto sys.path (idempotent).

    If ``research_paper_graph`` is already importable (e.g. running inside the
    paper-sync Docker image, where it lives on PYTHONPATH at /app), this is a
    no-op — we don't require the sibling-folder layout in that case.
    """
    import importlib.util

    if importlib.util.find_spec("research_paper_graph") is not None:
        return None

    root = find_research_paper_graph_root()
    if root is None:
        raise ImportError(
            "Could not locate the 'research-paper-graph' package to import. "
            f"Expected a sibling folder named '{_SIBLING_DIR_NAME}/' containing "
            f"'{_INNER_PACKAGE}/__init__.py'. This recommender reuses that package "
            "as a library and does not vendor its files."
        )
    path_str = str(root)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)
    return root
