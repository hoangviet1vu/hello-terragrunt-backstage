# Requirements Document

## Introduction

This spec captures a repository maintenance change: renaming the top-level `examples/`
directory to `templates/` and updating every reference to the old path across configuration,
build, and documentation files. The goal is a clean, consistent rename that preserves Git
history and does not change any runtime behavior, catalog entity identities, or references to
upstream Backstage resources.

Note: This spec was authored to document a change that was applied ahead of the spec workflow.
It reflects the change as implemented.

## Requirements

### Requirement 1: Rename the directory preserving history

**User Story:** As a maintainer, I want the `examples/` folder renamed to `templates/`, so that
the folder name better reflects its role (catalog entities, org data, and the starter template).

#### Acceptance Criteria

1. WHEN the rename is performed THEN the system SHALL move `examples/` to `templates/` using a
   history-preserving move (`git mv`).
2. WHEN the move completes THEN the `templates/` directory SHALL contain `entities.yaml`,
   `org.yaml`, and the full `template/` subtree unchanged in content.
3. WHEN `git status` is inspected THEN each moved file SHALL be reported as a rename (R), not as
   a delete + add.

### Requirement 2: Update local and production catalog config

**User Story:** As an operator, I want `app-config.yaml` and `app-config.production.yaml` to
point at the new path, so that the catalog loads the demo entities/template after the rename.

#### Acceptance Criteria

1. WHEN `app-config.yaml` is loaded THEN its `catalog.locations` targets SHALL reference
   `../../templates/entities.yaml`, `../../templates/template/template.yaml`, and
   `../../templates/org.yaml`.
2. WHEN `app-config.production.yaml` is loaded THEN its `catalog.locations` targets SHALL
   reference `./templates/entities.yaml`, `./templates/template/template.yaml`, and
   `./templates/org.yaml`.

### Requirement 3: Update the backend Dockerfile

**User Story:** As a deployer, I want the backend image build to copy the renamed folder, so that
the demo data/template is present in the container.

#### Acceptance Criteria

1. WHEN the backend Dockerfile is built THEN it SHALL `COPY --chown=node:node templates ./templates`.
2. WHEN the Dockerfile is read THEN the accompanying comment SHALL refer to `templates` rather
   than `examples`.

### Requirement 4: Update documentation references

**User Story:** As a contributor, I want the docs to describe the folder by its new name, so that
guidance matches the actual repo layout.

#### Acceptance Criteria

1. WHEN `README.md` is read THEN the repository-structure tree entry and the quick-start link
   SHALL reference `templates/` (link target `./templates`).
2. WHEN `AGENTS.md` is read THEN all folder-path references SHALL use `templates/` /
   `templates/template/template.yaml`.

### Requirement 5: Preserve identities and external references

**User Story:** As a maintainer, I want the rename limited to folder paths, so that catalog entity
identities and upstream references are not accidentally changed.

#### Acceptance Criteria

1. WHEN `templates/entities.yaml` is inspected THEN the catalog `name: examples` and
   `system: examples` values SHALL remain unchanged (they are entity/system identifiers, not
   folder paths).
2. WHEN `app-config.yaml` is inspected THEN commented-out URLs pointing at the upstream Backstage
   repository's own `examples/` path SHALL remain unchanged.
3. WHEN the change is complete THEN no runtime behavior SHALL change beyond the resolved file
   locations of the catalog demo data.

## Glossary

- **Catalog location:** An entry under `catalog.locations` in an `app-config*.yaml` file that
  tells the Backstage catalog backend where to read entity descriptors from.
- **Entity/System identifier:** The `name`/`system` values in a catalog descriptor. These are
  logical identities, independent of the file path the descriptor lives at.
- **History-preserving move:** A `git mv` that records the change as a rename so blame/history
  follow the file.
