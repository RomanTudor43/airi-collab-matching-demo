# Phase 2 Refactoring: Deep Parameter Cleanup

## Overview
This summary is archived. The project now performs OpenAlex and Unpaywall lookups live on each execution, and no on-disk fetch state is stored.

## Current Behavior
- OpenAlex work retrieval always uses live API paging.
- Unpaywall PDF lookups are live per run.
- PDF uploads are skipped when Strapi already has a PDF attached.

## Notes
Historical details for the earlier phase are no longer accurate after the fetch state removal.
