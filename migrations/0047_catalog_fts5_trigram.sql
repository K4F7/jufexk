-- #666: candidate narrowing for public catalog search. The projection tables
-- remain the source of truth; external-content FTS tables only store the
-- searchable text and are maintained by projection-table triggers.
CREATE VIRTUAL TABLE course_search_fts USING fts5(
  match_text,
  pinyin_text,
  teacher_variant_text,
  content='public_course_canonicals',
  content_rowid='course_id',
  tokenize='trigram'
);

CREATE VIRTUAL TABLE teacher_search_fts USING fts5(
  match_text,
  pinyin_text,
  content='public_teacher_search',
  content_rowid='teacher_id',
  tokenize='trigram'
);

CREATE TRIGGER public_course_canonicals_fts_ai
AFTER INSERT ON public_course_canonicals BEGIN
  INSERT INTO course_search_fts(rowid,match_text,pinyin_text,teacher_variant_text)
  VALUES(new.course_id,new.match_text,new.pinyin_text,new.teacher_variant_text);
END;
CREATE TRIGGER public_course_canonicals_fts_ad
AFTER DELETE ON public_course_canonicals BEGIN
  INSERT INTO course_search_fts(course_search_fts,rowid,match_text,pinyin_text,teacher_variant_text)
  VALUES('delete',old.course_id,old.match_text,old.pinyin_text,old.teacher_variant_text);
END;
CREATE TRIGGER public_course_canonicals_fts_au
AFTER UPDATE ON public_course_canonicals BEGIN
  INSERT INTO course_search_fts(course_search_fts,rowid,match_text,pinyin_text,teacher_variant_text)
  VALUES('delete',old.course_id,old.match_text,old.pinyin_text,old.teacher_variant_text);
  INSERT INTO course_search_fts(rowid,match_text,pinyin_text,teacher_variant_text)
  VALUES(new.course_id,new.match_text,new.pinyin_text,new.teacher_variant_text);
END;

CREATE TRIGGER public_teacher_search_fts_ai
AFTER INSERT ON public_teacher_search BEGIN
  INSERT INTO teacher_search_fts(rowid,match_text,pinyin_text)
  VALUES(new.teacher_id,new.match_text,new.pinyin_text);
END;
CREATE TRIGGER public_teacher_search_fts_ad
AFTER DELETE ON public_teacher_search BEGIN
  INSERT INTO teacher_search_fts(teacher_search_fts,rowid,match_text,pinyin_text)
  VALUES('delete',old.teacher_id,old.match_text,old.pinyin_text);
END;
CREATE TRIGGER public_teacher_search_fts_au
AFTER UPDATE ON public_teacher_search BEGIN
  INSERT INTO teacher_search_fts(teacher_search_fts,rowid,match_text,pinyin_text)
  VALUES('delete',old.teacher_id,old.match_text,old.pinyin_text);
  INSERT INTO teacher_search_fts(rowid,match_text,pinyin_text)
  VALUES(new.teacher_id,new.match_text,new.pinyin_text);
END;

INSERT INTO course_search_fts(course_search_fts) VALUES('rebuild');
INSERT INTO teacher_search_fts(teacher_search_fts) VALUES('rebuild');
