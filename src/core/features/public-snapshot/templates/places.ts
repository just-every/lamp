/** Where a component's free-text region sits on the world map, as [latitude, longitude]. Owners write regions as
 *  continents, countries, cities or cloud region codes; a name this table does not know gets no map position and
 *  stays a filter only, rather than a guessed place. */
type Place = readonly [number, number];

const cities: Record<string, Place> = {
  "london": [51.5, -0.1], "paris": [48.9, 2.4], "frankfurt": [50.1, 8.7], "amsterdam": [52.4, 4.9], "dublin": [53.3, -6.3],
  "stockholm": [59.3, 18.1], "oslo": [59.9, 10.8], "helsinki": [60.2, 24.9], "copenhagen": [55.7, 12.6], "brussels": [50.8, 4.4],
  "berlin": [52.5, 13.4], "munich": [48.1, 11.6], "zurich": [47.4, 8.5], "geneva": [46.2, 6.1], "vienna": [48.2, 16.4],
  "milan": [45.5, 9.2], "rome": [41.9, 12.5], "madrid": [40.4, -3.7], "barcelona": [41.4, 2.2], "lisbon": [38.7, -9.1],
  "warsaw": [52.2, 21], "prague": [50.1, 14.4], "istanbul": [41, 29], "tel aviv": [32.1, 34.8], "dubai": [25.2, 55.3],
  "abu dhabi": [24.5, 54.4], "doha": [25.3, 51.5], "riyadh": [24.7, 46.7], "bahrain": [26, 50.5], "cairo": [30, 31.2],
  "lagos": [6.5, 3.4], "nairobi": [-1.3, 36.8], "johannesburg": [-26.2, 28], "cape town": [-33.9, 18.4], "mumbai": [19.1, 72.9],
  "delhi": [28.6, 77.2], "bangalore": [13, 77.6], "bengaluru": [13, 77.6], "hyderabad": [17.4, 78.5], "chennai": [13.1, 80.3],
  "pune": [18.5, 73.9], "singapore": [1.35, 103.8], "jakarta": [-6.2, 106.8], "kuala lumpur": [3.1, 101.7], "bangkok": [13.8, 100.5],
  "manila": [14.6, 121], "hong kong": [22.3, 114.2], "taipei": [25, 121.5], "shanghai": [31.2, 121.5], "beijing": [39.9, 116.4],
  "shenzhen": [22.5, 114.1], "seoul": [37.6, 127], "tokyo": [35.7, 139.7], "osaka": [34.7, 135.5], "sydney": [-33.9, 151.2],
  "melbourne": [-37.8, 145], "brisbane": [-27.5, 153], "perth": [-32, 115.9], "auckland": [-36.8, 174.8], "toronto": [43.7, -79.4],
  "montreal": [45.5, -73.6], "vancouver": [49.3, -123.1], "calgary": [51, -114.1], "new york": [40.7, -74], "ashburn": [39, -77.5],
  "virginia": [37.5, -78.5], "ohio": [40.4, -82.9], "iowa": [42, -93.5], "chicago": [41.9, -87.6], "dallas": [32.8, -96.8],
  "texas": [31, -99], "atlanta": [33.7, -84.4], "miami": [25.8, -80.2], "denver": [39.7, -105], "phoenix": [33.4, -112.1],
  "las vegas": [36.2, -115.1], "los angeles": [34.1, -118.2], "san francisco": [37.8, -122.4], "silicon valley": [37.4, -122],
  "california": [37, -120], "oregon": [44, -120.5], "seattle": [47.6, -122.3], "washington": [47.4, -120.5], "carolina": [33.8, -80.9],
  "mexico city": [19.4, -99.1], "queretaro": [20.6, -100.4], "sao paulo": [-23.5, -46.6], "rio de janeiro": [-22.9, -43.2],
  "santiago": [-33.4, -70.6], "buenos aires": [-34.6, -58.4], "bogota": [4.7, -74.1], "lima": [-12, -77],
};

const countries: Record<string, Place> = {
  "united states": [39, -98], "usa": [39, -98], "us": [39, -98], "canada": [56, -100], "mexico": [23, -102], "brazil": [-10, -52],
  "argentina": [-35, -65], "chile": [-33, -71], "colombia": [4, -73], "peru": [-10, -75], "united kingdom": [54, -2], "uk": [54, -2],
  "britain": [54, -2], "england": [52.5, -1.5], "ireland": [53.3, -8], "france": [46.6, 2.4], "germany": [51.2, 10.4],
  "netherlands": [52.2, 5.3], "belgium": [50.6, 4.6], "switzerland": [46.8, 8.2], "austria": [47.6, 14.1], "italy": [42.8, 12.6],
  "spain": [40.2, -3.6], "portugal": [39.6, -8], "sweden": [62, 15], "norway": [61, 9], "finland": [63, 26], "denmark": [56, 9.5],
  "poland": [52, 19.4], "israel": [31.5, 34.9], "uae": [24, 54], "united arab emirates": [24, 54], "saudi arabia": [24, 45],
  "qatar": [25.3, 51.2], "turkey": [39, 35], "egypt": [26.8, 30.8], "nigeria": [9, 8], "kenya": [0.2, 37.9], "south africa": [-29, 25],
  "india": [21, 78], "china": [35, 104], "japan": [36.2, 138.3], "korea": [36.5, 127.8], "south korea": [36.5, 127.8],
  "taiwan": [23.7, 121], "indonesia": [-2.5, 118], "malaysia": [4.2, 102], "thailand": [15.9, 101], "vietnam": [16, 107.8],
  "philippines": [12.9, 121.8], "australia": [-25.3, 133.8], "new zealand": [-41.3, 174], "russia": [58, 60],
};

const areas: Record<string, Place> = {
  "north america": [44, -100], "americas": [15, -85], "latin america": [-8, -62], "latam": [-8, -62], "central america": [14, -87],
  "caribbean": [18, -72], "south america": [-15, -60], "europe": [50, 10], "eu": [50, 10], "emea": [45, 15], "western europe": [48, 3],
  "northern europe": [60, 15], "nordics": [62, 15], "scandinavia": [62, 15], "southern europe": [41, 12], "eastern europe": [51, 26],
  "central europe": [49.5, 15], "middle east": [27, 45], "africa": [3, 20], "asia": [34, 100], "east asia": [34, 118],
  "south asia": [22, 78], "southeast asia": [5, 110], "asia pacific": [12, 120], "apac": [12, 120], "pacific": [-15, 160],
  "oceania": [-25, 140], "australasia": [-30, 150], "us east": [38, -78], "east us": [38, -78], "us west": [38, -120],
  "west us": [38, -120], "us central": [41, -94], "central us": [41, -94],
};

// Cloud region codes name their city in the provider's own documentation.
const codes: Record<string, Place> = {
  "us-east-1": cities["virginia"]!, "us-east-2": cities["ohio"]!, "us-west-1": cities["california"]!, "us-west-2": cities["oregon"]!,
  "ca-central-1": cities["montreal"]!, "ca-west-1": cities["calgary"]!, "sa-east-1": cities["sao paulo"]!, "mx-central-1": cities["queretaro"]!,
  "eu-west-1": countries["ireland"]!, "eu-west-2": cities["london"]!, "eu-west-3": cities["paris"]!, "eu-central-1": cities["frankfurt"]!,
  "eu-central-2": cities["zurich"]!, "eu-north-1": cities["stockholm"]!, "eu-south-1": cities["milan"]!, "eu-south-2": countries["spain"]!,
  "ap-northeast-1": cities["tokyo"]!, "ap-northeast-2": cities["seoul"]!, "ap-northeast-3": cities["osaka"]!, "ap-southeast-1": cities["singapore"]!,
  "ap-southeast-2": cities["sydney"]!, "ap-southeast-3": cities["jakarta"]!, "ap-southeast-4": cities["melbourne"]!, "ap-southeast-5": countries["malaysia"]!,
  "ap-south-1": cities["mumbai"]!, "ap-south-2": cities["hyderabad"]!, "ap-east-1": cities["hong kong"]!, "me-south-1": cities["bahrain"]!,
  "me-central-1": countries["uae"]!, "af-south-1": cities["cape town"]!, "il-central-1": cities["tel aviv"]!,
  "us-central1": cities["iowa"]!, "us-east1": cities["carolina"]!, "us-east4": cities["virginia"]!, "us-west1": cities["oregon"]!,
  "us-west2": cities["los angeles"]!, "europe-west1": countries["belgium"]!, "europe-west2": cities["london"]!, "europe-west3": cities["frankfurt"]!,
  "europe-west4": countries["netherlands"]!, "europe-north1": countries["finland"]!, "asia-east1": countries["taiwan"]!, "asia-east2": cities["hong kong"]!,
  "asia-northeast1": cities["tokyo"]!, "asia-southeast1": cities["singapore"]!, "asia-south1": cities["mumbai"]!, "australia-southeast1": cities["sydney"]!,
  "southamerica-east1": cities["sao paulo"]!, "northamerica-northeast1": cities["montreal"]!,
  "eastus": cities["virginia"]!, "eastus2": cities["virginia"]!, "westus": cities["california"]!, "westus2": cities["washington"]!,
  "centralus": cities["iowa"]!, "westeurope": countries["netherlands"]!, "northeurope": countries["ireland"]!, "uksouth": cities["london"]!,
  "francecentral": cities["paris"]!, "germanywestcentral": cities["frankfurt"]!, "swedencentral": countries["sweden"]!,
  "southeastasia": cities["singapore"]!, "eastasia": cities["hong kong"]!, "japaneast": cities["tokyo"]!, "australiaeast": cities["sydney"]!,
  "centralindia": cities["pune"]!, "brazilsouth": cities["sao paulo"]!, "canadacentral": cities["toronto"]!, "uaenorth": cities["dubai"]!,
  "southafricanorth": cities["johannesburg"]!,
};

// An unlisted code still names its continent and a direction within it.
const prefixes: Array<[RegExp, Place]> = [
  [/^(us|northamerica)-?(east)/, areas["us east"]!], [/^(us|northamerica)-?(west)/, areas["us west"]!], [/^(us|northamerica)-?/, areas["us central"]!],
  [/^ca-/, countries["canada"]!], [/^(sa|southamerica)-/, areas["south america"]!], [/^mx-/, countries["mexico"]!],
  [/^(eu|europe)-?(north)/, areas["northern europe"]!], [/^(eu|europe)-?(south)/, areas["southern europe"]!], [/^(eu|europe)-?(west)/, areas["western europe"]!],
  [/^(eu|europe)-/, areas["europe"]!], [/^(ap|asia)-?(northeast)/, areas["east asia"]!], [/^(ap|asia)-?(southeast)/, areas["southeast asia"]!],
  [/^(ap|asia)-?(south)/, areas["south asia"]!], [/^(ap|asia)-/, areas["asia pacific"]!], [/^australia-/, countries["australia"]!],
  [/^me-/, areas["middle east"]!], [/^(af|africa)-/, areas["africa"]!], [/^il-/, countries["israel"]!],
];

function normalise(region: string) {
  return region.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_().,/]+/g, " ").replace(/\s+/g, " ").trim();
}

function mentioned(text: string, table: Record<string, Place>) {
  const words = ` ${text.replace(/-/g, " ")} `;
  const name = Object.keys(table).sort((left, right) => right.length - left.length).find((key) => words.includes(` ${key} `));
  return name ? table[name]! : null;
}

export function regionPlace(region: string): Place | null {
  const text = normalise(region);
  const code = text.replace(/\s+/g, "-");
  return codes[code] ?? codes[text.replace(/\s+/g, "")] ?? areas[text] ?? countries[text] ?? cities[text]
    ?? mentioned(text, cities) ?? mentioned(text, countries)
    ?? prefixes.find(([pattern]) => pattern.test(code))?.[1] ?? mentioned(text, areas) ?? null;
}
