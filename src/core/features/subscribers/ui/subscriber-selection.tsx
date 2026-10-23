import { useAppData } from "../../../app/client/ui/api";
import { FormError } from "../../../app/client/ui/states";

type Component = { id: string; name: string; internal: boolean };

export function SubscriberSelection({ selected, onChange, disabled }: { selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const { data, error, loading } = useAppData<{ components: Component[] }>("/api/app/components");
  return <fieldset className="maintenance-components" disabled={disabled || loading}>
    <legend>Components</legend>
    <p>Leave every box unchecked to follow all visible components.</p>
    {error ? <FormError>{error}</FormError> : null}
    {data?.components.filter(component => !component.internal).map(component => <label className="checkbox-label" key={component.id}>
      <input type="checkbox" checked={selected.includes(component.id)} onChange={() => onChange(selected.includes(component.id) ? selected.filter(id => id !== component.id) : [...selected, component.id])} />{component.name}
    </label>)}
  </fieldset>;
}
