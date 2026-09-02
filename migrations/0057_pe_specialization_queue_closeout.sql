-- Historical PE queue closeout: disposition status, freeze live enqueue, and
-- invalidate public precomputes when source-Relation mappings change.
-- Mapped rows stay as history with disposition='mapped'; withheld/conflict stay
-- as 暂不公开 / 冲突 records. Live import/upgrade must not insert new
-- umbrella_unmapped rows after this freeze.

ALTER TABLE catalog_pe_specialization_review_queue
  ADD COLUMN disposition TEXT CHECK (
    disposition IS NULL OR disposition IN (
      'mapped',
      'withheld_permanent_exception',
      'conflict_recapture'
    )
  );

ALTER TABLE catalog_pe_specialization_review_queue
  ADD COLUMN disposition_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE catalog_pe_specialization_review_queue
  ADD COLUMN disposition_evidence_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(disposition_evidence_json));

ALTER TABLE catalog_pe_specialization_review_queue
  ADD COLUMN disposed_by TEXT NOT NULL DEFAULT '';

ALTER TABLE catalog_pe_specialization_review_queue
  ADD COLUMN disposed_at TEXT;

CREATE INDEX idx_pe_queue_disposition
  ON catalog_pe_specialization_review_queue(disposition, created_at);

CREATE TABLE catalog_pe_specialization_queue_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  live_enqueue_enabled INTEGER NOT NULL DEFAULT 0 CHECK (live_enqueue_enabled IN (0, 1)),
  frozen_at TEXT,
  freeze_reason TEXT NOT NULL DEFAULT ''
);

INSERT INTO catalog_pe_specialization_queue_state(
  singleton, live_enqueue_enabled, frozen_at, freeze_reason
)
VALUES (
  1,
  0,
  CURRENT_TIMESTAMP,
  'historical closeout #852; queue is read-only history'
);

CREATE TRIGGER public_precompute_dirty_catalog_relation_pe_specializations_insert
AFTER INSERT ON catalog_relation_pe_specializations
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;

CREATE TRIGGER public_precompute_dirty_catalog_relation_pe_specializations_update
AFTER UPDATE OF normalized_specialization, source_kind, display_semantics
ON catalog_relation_pe_specializations
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;

CREATE TRIGGER public_precompute_dirty_catalog_relation_pe_specializations_delete
AFTER DELETE ON catalog_relation_pe_specializations
BEGIN
  UPDATE public_precompute_state
  SET dirty=1,generation=generation+1,refresh_token=NULL,refresh_lease_until=NULL
  WHERE id=1 AND (dirty=0 OR refresh_token IS NOT NULL);
END;
