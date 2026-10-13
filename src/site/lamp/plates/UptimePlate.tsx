import { Plate } from './Plate';
import { UptimeStrip } from './UptimeStrip';
import { CHECKOUT, HOST, UPTIME_METHOD_LEAD, uptimePercentage, uptimeWindow } from './sample';
import './uptime-plate.css';

const LABEL = "Drawing of Checkout's 90-day availability: 99.97%, with weighted downtime on 2 September and 9 October, and the stated weight of each state.";

// Plate E1: Checkout's row of the page's component health, with its 90-day strip, legend and stated method. The
// product's own blue and brown marks are drawn grey-green and ink; the meaning is the same. The figure stands beside the
// strip, and the stated method shows its first two sentences.
export function UptimePlate() {
  return <Plate label={LABEL} className="lamp-uptime" strip={HOST}>
    <span className="lamp-plate__eyebrow">Component health</span>
    <span className="lamp-plate__title">90-day availability</span>
    <span className="lamp-plate__eyebrow lamp-uptime__group">{CHECKOUT.groupName}</span>
    <div className="lamp-uptime__row">
      <span className="lamp-uptime__name">{CHECKOUT.name}</span>
      <span className="lamp-uptime__state"><span className="lamp-plate__dot lamp-plate__dot--down" />{CHECKOUT.state}</span>
      <span className="lamp-plate__small lamp-uptime__note">{CHECKOUT.note}</span>
    </div>
    <div className="lamp-uptime__measure">
      <UptimeStrip />
      <strong className="lamp-uptime__figure">{uptimePercentage}</strong>
    </div>
    <span className="lamp-uptime__window">{uptimeWindow}</span>
    <p className="lamp-uptime__legend"><span><i className="lamp-uptime__swatch" />Available</span><span><i className="lamp-uptime__swatch lamp-uptime__swatch--down" />Weighted downtime</span><span><i className="lamp-uptime__swatch lamp-uptime__swatch--none" />No data</span></p>
    <p className="lamp-uptime__method lamp-plate__muted">{UPTIME_METHOD_LEAD}</p>
  </Plate>;
}
