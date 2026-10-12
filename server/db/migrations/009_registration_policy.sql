ALTER TABLE school_settings ADD COLUMN student_approval_required INTEGER NOT NULL DEFAULT 0 CHECK (student_approval_required IN (0, 1));
