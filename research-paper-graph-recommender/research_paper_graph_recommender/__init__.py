"""Read-only collaboration-matching recommender for the AIRi@UTCN site.

This package is a *non-invasive* sibling of ``research-paper-graph``. It reuses
that package as a library (embedding model, Strapi GET utilities, config) and
never modifies it, the ``web/`` app, or any Strapi data. It performs GET
requests only.

Importing this package wires the sibling ``research-paper-graph`` folder onto
``sys.path`` so that ``research_paper_graph`` becomes importable.
"""

from ._bootstrap import ensure_research_paper_graph_importable

# Make the existing package importable as soon as this package is imported,
# so submodules can freely ``from research_paper_graph import ...``.
ensure_research_paper_graph_importable()
