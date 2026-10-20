import { useState, type ReactNode } from "react";

/** One found fact: a small label, the value, and Edit to change it in place. */
export function EditableRow({ label, name, value, editor }: { label: string; name: string; value: ReactNode; editor: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return <div className="found-row" data-found={name}>
    <div className="found-row-head"><p className="found-label">{label}</p><button type="button" className="found-edit" aria-label={`${editing ? "Done editing" : "Edit"} ${name}`} aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit"}</button></div>
    {editing ? <div className="found-editor">{editor}</div> : <div className="found-value">{value}</div>}
  </div>;
}
