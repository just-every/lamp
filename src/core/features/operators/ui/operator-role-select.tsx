import { useEffect, useState } from "react";

import type { StoredOperator } from "../repository";
import { Button } from "../../../app/client/ui/button";

type Role = StoredOperator["role"];
export const operatorRoleLabels: Record<Role, string> = {
  owner: "Owner", admin: "Admin", communicator: "Communicator", responder: "Responder", viewer: "Viewer",
};

export function OperatorRoleSelect({ operator, disabled, lastOwner, onChange }: {
  operator: StoredOperator;
  disabled: boolean;
  lastOwner: boolean;
  onChange: (role: Role) => Promise<boolean>;
}) {
  const [role, setRole] = useState(operator.role);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setRole(operator.role); setFailed(false); }, [operator.role]);

  async function save(next: Role) {
    setRole(next);
    setFailed(false);
    setFailed(!await onChange(next));
  }

  return <div className="page-stack">
    <label className="form-label">Role
      <select aria-label={`Role for ${operator.displayName}`} value={role} disabled={disabled || lastOwner} onChange={(event) => { void save(event.target.value as Role); }}>
        {Object.entries(operatorRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {failed && <Button type="button" variant="secondary" className="table-action" disabled={disabled || lastOwner} onClick={() => { void save(role); }}>Retry role change</Button>}
  </div>;
}
