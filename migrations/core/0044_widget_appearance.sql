-- Remember the operator's embed tag choices without changing the public widget defaults.
ALTER TABLE page_settings ADD COLUMN widget_appearance TEXT NOT NULL
  DEFAULT '{"variant":"banner","position":"bottom-right","background":"#ffffff","color":"#182d24","hideOperational":false}';
