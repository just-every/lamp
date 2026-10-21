/** The Regions map's dotted world. Land cells were sampled once from Natural Earth's 1:50m land polygons (public
 *  domain, naturalearthdata.com) on two equirectangular grids and stored as row-major bitsets, 1 = land. The wide
 *  view flattens the inhabited world into a band for desktop; the narrow view crops the Pacific and stands a little
 *  taller than true, so a phone keeps room for labels. Both are 1000 map units across. */
const views = {
  wide: {
    lon0: -169, lon1: 191, lat0: 78, lat1: -56, columns: 200, rows: 63,
    land: "AAAAPYDfwf///+AAAyAAAHAAB/AAAAAAAAAAAG/j34AD///gAAAAAAcAA//4AHwAAAAAAAD/t2/wAf//gAAAAAAYDD////wPgAAAD/wAB/zn/wD//8AAAD4ACB////////4UID/////7+5+A//4AAAP/8n////////////B///////8H4P/gXAAH///////////////+P//////7n8B/AHwAD9//////////////hD//////wDwAPAAAAH8//////////////4A/5////8AeAAQAAAB/P///////////8egAA4A////AH+AAAAAQDj//////////8AeAAAQAD////x/wAAAAODZ//////////8APAAAAAAf///+//gAAAOx////////////8DgAAAAAD//////4AAAAf/////////////AQAAAAAAP/////HAAAAB/////////////QAAAAAAAB/////xoAAAA/////////////gAAAAAAAAf////+AAAAAH+/xfP///////wAAAAAAAAH////4AAAAAf438D5///////4wAAAAAAAB////8AAAAAH4m//+f//////wIAAAAAAAAf///8AAAAAB8Bmf/n/////8YGAAAAAAAAD////AAAAAAO/AH////////zDAAAAAAAAAf///gAAAAAD/wAD///////4ngAAAAAAAAB///gAAAAAB//HB///////+CAAAAAAAAAAP//4AAAAAA////////////wAAAAAAAAAAD/wCAAAAAA/////+//////4AAAAAAAAAAAX8AgAAAAAP///+/5/////8AAAAAAAAAAAC/AAAAAAAH////3/wP///+QAAAAAAAAAAAHwhwAAAAD//////+B/9/+AAAAAAAAAAAAA8cFgAAAAf////v/AP8P6AAAAAAAAAAAAAH+AAAAAAH////9/gD8D+AQAAAAAAAAAAAAD8AAAAAD/////fgAeAPwMAAAAAAAAAAAAAPAAAAAA//////AAHgD+BgAAAAAAAAAAAAAw+gAAAD/////+AA4AnAAAAAAAAAAAAAAAH/+AAAA//////AAKAIgBAAAAAAAAAAAAAAH/wAAAH/////gAAgBAAQAAAAAAAAAAAAAB//gAAAeH///4AAABMHAAAAAAAAAAAAAAA//8AAAAAf//8AAAAPDgAAAAAAAAAAAAAAf//gAAAAH//8AAAABj9AAAAAAAAAAAAAAH//+AAAAB//+AAAAAOewWAAAAAAAAAAAAB///+AAAAP//AAAAABhMT8IAAAAAAAAAAAf///4AAAB//wAAAAAMAAH0AAAAAAAAAAAD///+AAAAf/8AAAAAA5AD8AAAAAAAAAAAA////AAAAH//AAAAAAAAAAgAAAAAAAAAAAH///gAAAB//4AAAAAAADjAAAAAAAAAAAAA///4AAAAf/+MAAAAAAD8wAAAAAAAAAAAAH//8AAAAP//HAAAAAAD/uAAAAAAAAAAAAAf//AAAAB//DgAAAAAB//wAAAAAAAAAAAAH//gAAAAf/g4AAAAAD//+AQAAAAAAAAAAB//wAAAAD/8OAAAAAB///wAAAAAAAAAAAA//gAAAAA/+DAAAAAAf//+AAAAAAAAAAAAP/4AAAAAP/AAAAAAAH///gAAAAAAAAAAAD/8AAAAAB/gAAAAAAB///4AAAAAAAAAAAA/+AAAAAAPwAAAAAAAP//+AAAAAAAAAAAAP/AAAAAAD4AAAAAAAD4H/AAAAAAAAAAAAH/AAAAAAAAAAAAAAAAAA/wAIAAAAAAAAAB/wAAAAAAAAAAAAAAAAAD4ABgAAAAAAAAAfwAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAHwAAAAAAAAAAAAAAAAAADAAYAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAA+AAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAPgAAAAAAAAAAACAAAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAA",
  },
  narrow: {
    lon0: -128, lon1: 182, lat0: 74, lat1: -50, columns: 104, rows: 52,
    land: "fVfA//AAAAQn//w4AF+38H/gADwEf////43//3h/wAD/H/////////58fhwB///////////7HDgIB/////////7/4GQYAA+///////54//B8AABHn//////CwP/8fgAAQz//////gYD///8AAOf//////+GA////AAA////////hAH///YAAP///////wAB///wAAD///////4AAf//0AAC++O////+gAH//4AAA8X5n///+IAB//8AAAOCv9///7CAAP//AAADdL/////ZAAD//gAAAfgH////lgAAP/wAAAP8j////8gAAD/8AAAH///////AAAA/hAAAD///////wAAAFwAAAA///9///4AAAAcAAAAf//v4//8AAAAHsQAAH///+Hz8AAAAA/BAAB///fB4+EAAAAC4AAAf//3AMHhAAAAAGAAAH///gDA8IAAAAAjwAA///8AwKCAAAAAH+AAP///AECAwAAAAAf4AB///wAAggAAAAAH/AAAP/4AAcYAAAAAD/wAAD/8AADPQAAAAA//AAA/+AAAzRAAAAAP/8AAP/gAAG0OAAAAD//gAB/wAAAgB0AAAA//4AAf8AAAGgeAAAAH/+AAH/gAAAAAAAAAB//AAB/5AAAAGgAAAAP/wAAf+wAAAHsAAAAB/8AAH/cAAAD/AAAAAf/AAB/jAAAD/4AAAAH/gAAf5gAAB//AAAAB/gAAD+IAAAf/wAAAAf4AAA/AAAAH/+AAAAH8AAAPwAAAB//gAAAB/AAAB4AAAAf/wAAAAfgAAAYAAAADD8AAAAPwAAAAAAAAAAOAQAAD4AAAAAAAAAABAGAAA8AAAAAAAAAAAYDAAAOAAAAAAAAAAAABgAADgAAAAAAAAAAAAQAAB4AAAAAAAAAAAAAA==",
  },
} as const;

export type MapView = keyof typeof views;
export const MAP_WIDTH = 1000;

export function mapHeight(view: MapView) {
  const { columns, rows } = views[view];
  return rows * (MAP_WIDTH / columns);
}

/** A place on the map in map units, kept inside the view: the narrow view's cropped edges hold what falls off. */
export function project(view: MapView, [lat, lon]: readonly [number, number]) {
  const { lon0, lon1, lat0, lat1 } = views[view];
  let longitude = lon;
  if (longitude < lon0) longitude += 360;
  if (longitude >= lon1) longitude -= 360;
  const x = ((longitude - lon0) / (lon1 - lon0)) * MAP_WIDTH;
  const y = ((lat0 - lat) / (lat0 - lat1)) * mapHeight(view);
  return { x: Math.min(MAP_WIDTH - 4, Math.max(4, x)), y: Math.min(mapHeight(view) - 4, Math.max(4, y)) };
}

const round = (value: number) => Number(value.toFixed(2));

function dotPath(view: MapView) {
  const { columns, rows, land } = views[view];
  const bits = Uint8Array.from(atob(land), (character) => character.charCodeAt(0));
  const step = MAP_WIDTH / columns;
  let path = "";
  for (let row = 0; row < rows; row += 1) {
    let previous = -1;
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (!(bits[index >> 3]! & (0x80 >> (index & 7)))) continue;
      path += previous < 0 ? `M${round((column + 0.5) * step)} ${round((row + 0.5) * step)}h0` : `m${round((column - previous) * step)} 0h0`;
      previous = column;
    }
  }
  return path;
}

const paths = new Map<MapView, string>();

/** The land as one path of round zero-length strokes: one dot per land cell. */
export function worldDots(view: MapView) {
  if (!paths.has(view)) paths.set(view, dotPath(view));
  return paths.get(view)!;
}
