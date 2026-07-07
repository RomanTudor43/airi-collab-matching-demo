#!/usr/bin/env python3
"""Entry point — mirrors research-paper-graph/main.py.

Run:  python recommend.py --interests "integrated circuits, ML, energy" --top 5
"""
from research_paper_graph_recommender.cli import main


if __name__ == "__main__":
    main()
