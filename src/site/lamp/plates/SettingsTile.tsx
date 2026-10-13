import { Plate } from './Plate';
import { SETTINGS } from './sample';
import './settings-tile.css';

const LABEL = 'Drawing of the public page settings: host name status.example.com and accent colour #18221b.';

// T5: the operator's public page settings, its first two fields: the page's own host and its colour. The accent colour
// is a text field in the product, so no swatch is drawn; the timezone and footer credit follow below the crop.
export function SettingsTile() {
  return <Plate label={LABEL} className="lamp-tile lamp-settings">
    <span className="lamp-plate__eyebrow">Public page configuration</span>
    <span className="lamp-plate__title lamp-plate__title--tile">Settings</span>
    {SETTINGS.map(([label, value]) => <span className="lamp-settings__field" key={label}><span className="lamp-settings__label">{label}</span><span className="lamp-settings__value">{value}</span></span>)}
  </Plate>;
}
