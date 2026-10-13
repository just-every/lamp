import { PlainText } from './PlainText';
import { Plate } from './Plate';
import { OVERALL, OWNER_SITE, widgetLines } from './sample';
import './banner-plate.css';

const LABEL = 'Drawing of the Lamp banner on your own website: Partially unavailable, Card payments failing, followed by the same update.';

// Plate B2: the site banner the product's widget renders on an origin the owner listed. The widget's own dot is
// #d66a1f, outside this page's palette, so it is drawn amber, as the current state (plates/sample.ts).
export function BannerPlate() {
  const [first, ...rest] = widgetLines;
  return <Plate label={LABEL} className="lamp-same__plate lamp-same__plate--banner" strip={OWNER_SITE} stripEnd={<span className="lamp-plate__pill">Site banner</span>}>
    <div className="lamp-banner">
      <p className="lamp-banner__first"><span className="lamp-banner__dot" /><strong>{OVERALL}</strong>{first}</p>
      <PlainText lines={rest} highlight className="lamp-banner__text" />
    </div>
  </Plate>;
}
