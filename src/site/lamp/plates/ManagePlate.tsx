import { Plate } from './Plate';
import { Tick } from './Tick';
import { COMPONENTS, HOST } from './sample';
import './manage-plate.css';

const LABEL = 'Drawing of the Manage subscription page: channel email; Checkout and Email receipts are selected, Website and Sign-in are not; a Save selection button, and an Unsubscribe button that ends the subscription in one click.';
const SELECTED = new Set(['Checkout', 'Email receipts']);

// Plate C: the subscriber's Manage subscription page, its components in the order the page prints them (by display
// order alone; the sample numbers them 1 to 4, so it matches the public page). The page's helper line under Components
// is left out of the drawing.
export function ManagePlate() {
  const components = [...COMPONENTS].sort((left, right) => left.displayOrder - right.displayOrder);
  return <Plate label={LABEL} className="lamp-manage" strip={HOST}>
    <u className="lamp-plate__link">← Public status page</u>
    <span className="lamp-plate__title lamp-plate__title--screen lamp-manage__title">Manage subscription</span>
    <p className="lamp-manage__channel">Channel: email</p>
    <div className="lamp-manage__set">
      <span className="lamp-manage__legend">Components</span>
      {components.map((component) => <span className="lamp-manage__choice" key={component.id}><Tick checked={SELECTED.has(component.name)} />{component.name}</span>)}
    </div>
    <span className="lamp-plate__button">Save selection</span>
    <hr className="lamp-plate__rule lamp-manage__rule" />
    <span className="lamp-plate__button lamp-plate__button--secondary">Unsubscribe</span>
  </Plate>;
}
