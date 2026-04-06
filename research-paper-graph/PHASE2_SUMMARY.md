# Phase 2 Refactoring: Deep Parameter Cleanup

## Overview
This phase addressed the observation that while `_apply_runtime_defaults()` was removed, the constant parameters were still being passed through multiple function layers. This phase propagates the simplification down to the lowest level.

## Changes Made

### 1. Simplified OpenAlex API Functions
**`get_author_papers()`**:
- Before: `get_author_papers(author_id, *, cache_path=None, use_cache=False, refresh_cache=False)`
- After: `get_author_papers(author_id, *, cache_path=None)`
- Removed: `use_cache` and `refresh_cache` parameters (always True and False)

**`get_institution_papers()`**:
- Before: `get_institution_papers(institution_id, *, cache_path=None, use_cache=False, refresh_cache=False)`
- After: `get_institution_papers(institution_id, *, cache_path=None)`
- Removed: Same parameters

### 2. Simplified `_get_processed_works()` Internal Logic
**Removed redundant conditionals**:
- Deleted `use_cache` and `refresh_cache` parameters
- Removed 4 conditional branches that never executed:
  - "cache exists but cache reuse is disabled; refetching"
  - "incomplete cache exists but cache reuse is disabled; refetching"
  - The entire refresh_cache deletion logic
  - The use_cache flag checks

**New behavior** (simplified):
- If cache exists and is complete → return it
- If cache exists and is incomplete → resume from it
- If no cache → fetch from scratch
- Always write progress to cache (for resume capability)

### 3. Updated Call Sites in `sources.py`
Removed 12 lines of parameter passing:
```python
# Before:
papers = oaf.get_author_papers(
    author_id,
    cache_path=cache_path,
    use_cache=True,
    refresh_cache=False,
)

# After:
papers = oaf.get_author_papers(author_id, cache_path=cache_path)
```

## Impact
- **Lines removed**: 41 lines across openalex.py and sources.py
- **Lines added**: 21 (improved docstring in `_get_processed_works`)
- **Net change**: -20 lines
- **Conditionals eliminated**: 4 branches that always went the same way
- **Parameters removed**: 2 redundant boolean flags from 2 functions

## Verification
✓ All Python files compile successfully
✓ No references to `use_cache` or `refresh_cache` remain
✓ Cache behavior unchanged (always enabled, always resumes)
✓ No behavioral changes - pure simplification

## Combined Stats (Phase 1 + Phase 2)
- **Total files modified**: 5
- **Total lines removed**: ~197
- **Total lines added**: ~65
- **Net reduction**: -132 lines
- **Dead parameters removed**: 12 total
- **Redundant conditionals eliminated**: 4+
