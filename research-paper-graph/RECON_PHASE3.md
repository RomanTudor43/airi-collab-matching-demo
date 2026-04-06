# Phase 3 Reconnaissance: Remaining Simplification Opportunities

## Executive Summary
After Phases 1 and 2, there are still several categories of redundant parameters and code patterns that can be simplified.

---

## Category 1: Hardcoded Boolean Parameters (Always False)

### `skip_graph` and `skip_communities` in `build_graph_artifacts()`

**Current state:**
- `cli.py` line 63-64: Always passes `skip_graph=False, skip_communities=False`
- `cli.py` line 88-89: Always passes `skip_graph=False, skip_communities=False`
- `pipeline.py` line 38-39: Has these as parameters with default `False`
- `pipeline.py` line 50: `if skip_graph:` conditional (never executes)
- `pipeline.py` line 86: `if not skip_communities:` conditional (always executes)

**Problem:**
- These parameters are ALWAYS False at every call site
- The `skip_graph` conditional has a dead branch (lines 50-59)
- The `skip_communities` check is redundant

**Simplification opportunity:**
1. Remove `skip_graph` and `skip_communities` parameters from `build_graph_artifacts()`
2. Remove the `if skip_graph:` dead code block
3. Remove the `if not skip_communities:` conditional wrapper
4. Always build the graph and communities (current runtime behavior)

---

## Category 2: Hardcoded Numeric Parameter (Always 1.0)

### `community_resolution` in `build_graph_artifacts()`

**Current state:**
- `cli.py` line 68: Always passes `community_resolution=1.0`
- `cli.py` line 93: Always passes `community_resolution=1.0`
- `pipeline.py` line 43: Has default `community_resolution=1.0`
- `pipeline.py` line 92: Passes to `gg.detect_communities(..., resolution=community_resolution)`

**Problem:**
- This parameter is ALWAYS 1.0 at every call site
- Just adds unnecessary parameter passing

**Simplification opportunity:**
1. Remove `community_resolution` parameter from `build_graph_artifacts()`
2. Hardcode `resolution=1.0` in the call to `gg.detect_communities()`

---

## Category 3: Optional Parameters That Are Never Varied

### `output_dir` in `build_graph_artifacts()` and `save_paper_snapshot()`

**Current state:**
- `save_paper_snapshot()`: Has `output_dir="outputs"` parameter
- `build_graph_artifacts()`: Has `output_dir="outputs"` parameter
- **NEVER called with a different value** - always uses default "outputs"

**Problem:**
- Dead parameter - adds complexity without value
- If we ever needed to change it, we'd change it in one place (a constant)

**Simplification opportunity:**
1. Remove `output_dir` parameter from both functions
2. Use hardcoded `"outputs"` directory
3. Or define a module constant `OUTPUT_DIR = "outputs"`

---

## Category 4: Logger Pattern Inconsistency

### `logger=` parameter usage

**Current state:**
- `fetch_papers(args, logger=None, settings=None)`
- `save_paper_snapshot(papers, label, output_dir="outputs", logger=None)`
- `build_graph_artifacts(..., logger=None)`
- All functions: `log = logger or logging.getLogger("paper-sync")`
- **All call sites**: Always pass `logger=log` (the same logger)

**Problem:**
- Every function has the same fallback pattern
- Every call site passes the same logger instance
- Parameter exists "just in case" but is never actually varied

**Options:**
1. **Keep it** (reasonable for testing/flexibility)
2. **Remove it** and use module-level logger everywhere
3. **Simplify**: Only pass logger at top level, use module logger in helpers

**Recommendation:** KEEP THIS - it's good for testability

---

## Category 5: args Object Still Being Passed

### `fetch_papers(args, ...)` signature

**Current state:**
- `fetch_papers()` still receives entire `args` object
- Only uses: `args.institution` and `args.person` via getattr
- Also uses `settings` parameter

**Problem:**
- Still passing entire args object when we only need 2 strings
- Inconsistent with the refactoring philosophy

**Simplification opportunity:**
```python
# Before:
def fetch_papers(args, logger=None, settings=None):
    institution_name = (getattr(args, "institution", None) or "").strip()
    person_name = (getattr(args, "person", None) or "").strip()

# After:
def fetch_papers(institution=None, person=None, settings=None, logger=None):
    institution_name = (institution or "").strip()
    person_name = (person or "").strip()
```

Update call site in `cli.py`:
```python
# Before:
papers, label = fetch_papers(args, logger=log, settings=SETTINGS)

# After:
papers, label = fetch_papers(
    institution=args.institution,
    person=args.person,
    settings=SETTINGS,
    logger=log
)
```

---

## Category 6: The `--dry-run` Flag

### Current state:
- `cli.py` line 42-46: CLI argument definition
- `cli.py` line 77-79: Check and early return

**Analysis:**
- This is a **LEGITIMATE** user-facing parameter
- It's **actually used** and **provides value**
- Different from the removed parameters (which were vestigial)

**Recommendation:** **KEEP THIS** - it's a real feature, not dead code

---

## Category 7: Source Selection in main()

### Current state (cli.py lines 117-124):
```python
has_source_selector = bool(
    getattr(args, "strapi_people", False)
    or getattr(args, "institution", None)
    or getattr(args, "person", None)
)
```

**Analysis:**
- This is fine - just checking if user provided any source
- Not redundant, serves validation purpose

**Recommendation:** **KEEP THIS** - it's correct validation logic

---

## Summary of Actionable Simplifications

### High Priority (Always-constant parameters):
1. ✅ Remove `skip_graph` parameter (always False)
2. ✅ Remove `skip_communities` parameter (always False)
3. ✅ Remove `community_resolution` parameter (always 1.0)
4. ✅ Remove dead `if skip_graph:` block

### Medium Priority (Never-varied defaults):
5. ✅ Remove `output_dir` parameter (always "outputs")

### Lower Priority (Cleaner signatures):
6. ✅ Replace `args` parameter in `fetch_papers()` with explicit parameters

### Keep As-Is (Good reasons):
- ❌ `--dry-run` flag: Real user feature
- ❌ `logger=` parameters: Good for testability
- ❌ Source selector validation: Correct logic

---

## Estimated Impact

**Lines to remove:** ~15-20 lines
**Parameters to eliminate:** 5 (skip_graph, skip_communities, community_resolution, output_dir, args)
**Dead code blocks:** 1 (skip_graph early return)
**Redundant conditionals:** 1 (skip_communities wrapper)

**Result:** Even cleaner API with only meaningful parameters
