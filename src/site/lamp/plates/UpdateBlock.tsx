import './update-block.css';

type Update = { lifecycle: string; time: string; fields: Array<{ label: string; value: string }> };

// One published update as the product prints it: the state and its time, then its fields as label and value pairs.
// The current update or notice takes the amber fill.
export function UpdateBlock({ update, current = false, className = '' }: { update: Update; current?: boolean; className?: string }) {
  return <div className={`lamp-update${current ? ' lamp-plate__current' : ''}${className ? ` ${className}` : ''}`}>
    <div className="lamp-update__head"><span className="lamp-plate__eyebrow">{update.lifecycle}</span><span className="lamp-plate__small lamp-plate__muted">{update.time}</span></div>
    <dl className="lamp-plate__fields">
      {update.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
    </dl>
  </div>;
}
