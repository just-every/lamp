/** Each window owns its automation choices; existing windows default to both
 * on. These visible labels use the maintenance form's existing controls. */
export function MaintenanceAutomationSwitches({ autoStart, autoComplete, onAutoStart, onAutoComplete, disabled = false, showStart = true }: {
  autoStart: boolean;
  autoComplete: boolean;
  onAutoStart: (value: boolean) => void;
  onAutoComplete: (value: boolean) => void;
  disabled?: boolean;
  showStart?: boolean;
}) {
  return <fieldset className="maintenance-components" disabled={disabled}>
    <legend>Automation for this window</legend>
    {showStart ? <label className="checkbox-label"><input type="checkbox" checked={autoStart} onChange={event => onAutoStart(event.target.checked)} />Auto-start maintenance</label> : null}
    <label className="checkbox-label"><input type="checkbox" checked={autoComplete} onChange={event => onAutoComplete(event.target.checked)} />Auto-complete maintenance</label>
  </fieldset>;
}
