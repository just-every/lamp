-- A page can choose House style (owner L18). The choice is its own column, added in place, so an archive made
-- before it restores as every additive migration's does; `template` holds Calm headline while it is chosen, the
-- built-in layout the page shows whenever its house style can't. Every existing page keeps the template it saved.
ALTER TABLE page_settings ADD COLUMN house_style INTEGER NOT NULL DEFAULT 0 CHECK (house_style IN (0, 1));
