import './tick.css';

// A drawn checkbox: ticked in ink with a white tick, or an empty outline. It is a drawing, not a control.
export function Tick({ checked }: { checked: boolean }) {
  return <span className={checked ? 'lamp-tick lamp-tick--checked' : 'lamp-tick'}>
    {checked ? <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false"><path d="M1.8 5.2l2.2 2.2 4.2-4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
  </span>;
}
