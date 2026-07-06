import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "data.db");
const db = new Database(dbPath);

interface Op {
  name: string;
  shell_llcs: string[];
  codenames: string[];
  annual_capex_billions?: number;
  active_markets?: string[];
}

const OPERATORS: Op[] = [
  // Hyperscalers
  { name: "Meta", shell_llcs: ["Raven Northbrook LLC","J5 LLC","Shaytura LLC","Balloonist LLC","Wildcat LLC","Goldframe LLC","Greater Kudu LLC","Siculus Inc.","Beehive LLC","Yonaguni LLC","Starbelt LLC","Sidecat LLC"], codenames: ["Hyperion","Prometheus","Klondike","Anthem","Jupiter"], annual_capex_billions: 40, active_markets: ["Loudoun VA","Prince William VA","Los Lunas NM","Newton GA","Gallatin TN","Kansas City MO","Idaho Falls ID"] },
  { name: "Google (Alphabet)", shell_llcs: ["Fireball Group","Westwood Solutions LLC","Agate LLC","Sharka LLC","Jet Stream LLC","Questa LLC","Gable Corp","Jasmine Development LLC","Design LLC","Sokka LLC","Zuko LLC"], codenames: ["Fairwater-adjacent"], annual_capex_billions: 75, active_markets: ["The Dalles OR","Council Bluffs IA","Loudoun VA","Storey NV","Papillion NE","Lenoir NC","Midlothian TX","Mesa AZ"] },
  { name: "Microsoft", shell_llcs: ["Various NDA shells","LYH03 Holdings","Project Firecracker Holdings","Project Agate Holdings","Project Yoga LLC","Project Pine LLC","Project Bailey LLC","Project Buffalo LLC"], codenames: ["Fairwater","Athena"], annual_capex_billions: 80, active_markets: ["Quincy WA","San Antonio TX","Cheyenne WY","West Des Moines IA","Racine WI","Boydton VA","Mount Pleasant WI"] },
  { name: "Amazon (AWS)", shell_llcs: ["Amazon Data Services LLC","Vadata Inc.","Vandalay Industries LLC","Immedia Semiconductor LLC","Cypress Bayou LLC"], codenames: [], annual_capex_billions: 90, active_markets: ["Loudoun VA","Ashburn VA","Prince William VA","Hilliard OH","New Albany OH","Umatilla OR","Boardman OR","Northern Virginia"] },

  // AI-native
  { name: "OpenAI / Stargate", shell_llcs: ["Crusoe Cloud","SB Investment Advisers","Lancium Compute"], codenames: ["Stargate"], annual_capex_billions: 50, active_markets: ["Abilene TX","Doña Ana NM","Lordstown OH"] },
  { name: "xAI", shell_llcs: ["xAI Colossus","Colossus Holdings LLC","X.AI Holdings"], codenames: ["Colossus"], annual_capex_billions: 12, active_markets: ["Memphis TN","Millington TN","Baton Rouge LA"] },
  { name: "Anthropic", shell_llcs: ["Anthropic Compute LLC"], codenames: [], annual_capex_billions: 8, active_markets: ["various colo tenancy"] },

  // Colo / wholesale
  { name: "Digital Realty", shell_llcs: ["Digital Realty Trust LP","DLR Ashburn LLC"], codenames: [], annual_capex_billions: 3.5, active_markets: ["Ashburn VA","Chicago IL","Dallas TX","Silicon Valley","Portland OR","New York NY"] },
  { name: "Equinix", shell_llcs: ["Equinix IBX","Equinix Data Center LLC"], codenames: [], annual_capex_billions: 3.2, active_markets: ["Ashburn VA","Silicon Valley","Chicago IL","Dallas TX","New York NY","Seattle WA","Miami FL"] },
  { name: "QTS (Blackstone)", shell_llcs: ["QTS Realty","QTS Data Centers LLC"], codenames: [], annual_capex_billions: 5, active_markets: ["Ashburn VA","Manassas VA","Fayetteville GA","Irving TX","Groveport OH","Hillsboro OR","Phoenix AZ"] },
  { name: "CyrusOne (KKR/GIP)", shell_llcs: ["CyrusOne LLC","CyrusOne LP"], codenames: [], annual_capex_billions: 2.5, active_markets: ["Sterling VA","Chandler AZ","Aurora IL","Carrollton TX","San Antonio TX","Council Bluffs IA"] },
  { name: "Iron Mountain Data Centers", shell_llcs: ["Iron Mountain Information Management LLC"], codenames: [], annual_capex_billions: 1.2, active_markets: ["Manassas VA","Boyers PA","Phoenix AZ","London UK"] },
  { name: "Vantage Data Centers", shell_llcs: ["Vantage NA LLC","Vantage Data Centers LLC"], codenames: [], annual_capex_billions: 3, active_markets: ["Ashburn VA","Santa Clara CA","Phoenix AZ","Quincy WA","Montreal QC"] },
  { name: "Aligned Data Centers", shell_llcs: ["Aligned Energy LLC","Aligned DC LLC"], codenames: [], annual_capex_billions: 4, active_markets: ["Ashburn VA","Phoenix AZ","Dallas TX","Salt Lake City UT","Columbus OH"] },
  { name: "Stack Infrastructure", shell_llcs: ["Stack Infrastructure LLC"], codenames: [], annual_capex_billions: 2, active_markets: ["Ashburn VA","Silicon Valley","Portland OR","Chicago IL"] },
  { name: "EdgeConneX", shell_llcs: ["EdgeConneX Inc.","EDGE Data Centers"], codenames: [], annual_capex_billions: 1.5, active_markets: ["Portland OR","Phoenix AZ","Chicago IL","Miami FL","Nashville TN"] },
  { name: "Compass Datacenters", shell_llcs: ["Compass DC LLC"], codenames: [], annual_capex_billions: 2, active_markets: ["Red Oak TX","Goodyear AZ","Sterling VA","Reno NV"] },
  { name: "Prime Data Centers", shell_llcs: ["Prime DC LLC"], codenames: [], annual_capex_billions: 1, active_markets: ["Sacramento CA","Elk Grove Village IL","Manassas VA"] },
  { name: "PowerHouse Data Centers", shell_llcs: ["PowerHouse LLC"], codenames: [], annual_capex_billions: 0.8, active_markets: ["Ashburn VA","Sterling VA"] },
  { name: "Cologix", shell_llcs: ["Cologix Inc."], codenames: [], annual_capex_billions: 0.9, active_markets: ["Montreal QC","Toronto ON","Columbus OH","Minneapolis MN","Jacksonville FL"] },
  { name: "DataBank", shell_llcs: ["DataBank Holdings"], codenames: [], annual_capex_billions: 1.1, active_markets: ["Atlanta GA","Dallas TX","Salt Lake City UT","Minneapolis MN","New York NY"] },
  { name: "H5 Data Centers", shell_llcs: ["H5 DC LLC"], codenames: [], annual_capex_billions: 0.6, active_markets: ["Denver CO","San Jose CA","Cincinnati OH","Nashville TN"] },
  { name: "Flexential", shell_llcs: ["Flexential Corp"], codenames: [], annual_capex_billions: 0.7, active_markets: ["Denver CO","Charlotte NC","Portland OR","Atlanta GA"] },
  { name: "TierPoint", shell_llcs: ["TierPoint LLC"], codenames: [], annual_capex_billions: 0.5, active_markets: ["St. Louis MO","Dallas TX","Baltimore MD","Seattle WA"] },
  { name: "Switch (DigitalBridge)", shell_llcs: ["Switch Ltd","Switch Inc."], codenames: [], annual_capex_billions: 1.4, active_markets: ["Las Vegas NV","Reno NV","Grand Rapids MI","Atlanta GA","Austin TX"] },

  // AI-cloud specialists
  { name: "CoreWeave", shell_llcs: ["CoreWeave Inc.","CoreWeave Compute LLC"], codenames: [], annual_capex_billions: 15, active_markets: ["Plano TX","Denton TX","Weehawken NJ","Chicago IL","Las Vegas NV"] },
  { name: "Lambda Labs", shell_llcs: ["Lambda Inc."], codenames: [], annual_capex_billions: 2, active_markets: ["Allen TX","Cupertino CA","San Francisco CA"] },
  { name: "Crusoe Energy", shell_llcs: ["Crusoe LLC","Crusoe Cloud LLC","Crusoe Compute LLC"], codenames: [], annual_capex_billions: 4, active_markets: ["Abilene TX","Kearney NE","Williston ND"] },
  { name: "Applied Digital", shell_llcs: ["Applied Digital Corp","APLD"], codenames: [], annual_capex_billions: 1.5, active_markets: ["Ellendale ND","Jamestown ND","Garden City TX"] },
  { name: "Iris Energy", shell_llcs: ["Iris Energy Ltd","IREN"], codenames: [], annual_capex_billions: 1, active_markets: ["Childress TX","Sweetwater TX","Prince George BC"] },
  { name: "Nebius (Yandex spin-out)", shell_llcs: ["Nebius Group","Nebius AI"], codenames: [], annual_capex_billions: 2, active_markets: ["Kansas City MO","Vineland NJ"] },

  // Crypto miners pivoting to AI HPC
  { name: "Core Scientific", shell_llcs: ["Core Scientific Inc.","CORZ"], codenames: [], annual_capex_billions: 1.2, active_markets: ["Denton TX","Muskogee OK","Marble NC","Cottonwood TX","Dalton GA"] },
  { name: "TeraWulf", shell_llcs: ["TeraWulf Inc.","WULF"], codenames: [], annual_capex_billions: 0.6, active_markets: ["Lake Mariner NY","Nautilus PA"] },
  { name: "Riot Platforms", shell_llcs: ["Riot Blockchain Inc.","RIOT"], codenames: [], annual_capex_billions: 0.8, active_markets: ["Rockdale TX","Corsicana TX"] },
  { name: "Bitfarms", shell_llcs: ["Bitfarms Ltd."], codenames: [], annual_capex_billions: 0.3, active_markets: ["Washington PA","Paso Pe QC"] },
  { name: "Hive Digital", shell_llcs: ["Hive Digital Technologies"], codenames: [], annual_capex_billions: 0.2, active_markets: ["New Brunswick CA","Sweden","Iceland"] },
  { name: "Cipher Mining", shell_llcs: ["Cipher Mining Inc.","CIFR"], codenames: [], annual_capex_billions: 0.4, active_markets: ["Odessa TX","Barber Lake TX"] },
  { name: "Marathon Digital", shell_llcs: ["Marathon Digital Holdings","MARA"], codenames: [], annual_capex_billions: 0.6, active_markets: ["Garden City TX","Kearney NE","Ellendale ND"] },
  { name: "CleanSpark", shell_llcs: ["CleanSpark Inc.","CLSK"], codenames: [], annual_capex_billions: 0.4, active_markets: ["Sandersville GA","Norcross GA","Cheyenne WY"] },

  // Sovereign / enterprise
  { name: "Oracle Cloud (OCI)", shell_llcs: ["Oracle Cloud Infrastructure LLC","Oracle America Inc."], codenames: [], annual_capex_billions: 25, active_markets: ["Ashburn VA","Chicago IL","Phoenix AZ","San Jose CA"] },
  { name: "IBM Cloud", shell_llcs: ["IBM Cloud Services LLC"], codenames: [], annual_capex_billions: 3, active_markets: ["Dallas TX","Washington DC","San Jose CA"] },

  // Private equity / infra buyers
  { name: "Blackstone Digital Infra", shell_llcs: ["Blackstone Infrastructure Partners","QTS Realty (portfolio)"], codenames: [], annual_capex_billions: 10, active_markets: ["Ashburn VA","Manassas VA","Fayetteville GA","Groveport OH"] },
  { name: "DigitalBridge", shell_llcs: ["DigitalBridge Group","Vantage (portfolio)","DataBank (portfolio)","Switch (portfolio)"], codenames: [], annual_capex_billions: 8, active_markets: ["Ashburn VA","Santa Clara CA","Phoenix AZ","Las Vegas NV"] },
  { name: "Brookfield Infrastructure", shell_llcs: ["Brookfield Infra Partners","Compass DC (portfolio)"], codenames: [], annual_capex_billions: 6, active_markets: ["Red Oak TX","Goodyear AZ","Sterling VA","Reno NV"] },
  { name: "KKR / GIP", shell_llcs: ["Global Infrastructure Partners","CyrusOne (portfolio)"], codenames: [], annual_capex_billions: 7, active_markets: ["Chandler AZ","Aurora IL","San Antonio TX"] },
];

// De-dupe any pre-existing duplicate names by keeping the lowest id, then
// create the unique index that the upsert relies on.
db.exec(`
  DELETE FROM operators WHERE id NOT IN (
    SELECT MIN(id) FROM operators GROUP BY name
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_operators_name ON operators(name);
`);

const upsert = db.prepare(`
  INSERT INTO operators (name, shell_llcs, codenames, annual_capex_billions, active_markets)
  VALUES (?,?,?,?,?)
  ON CONFLICT(name) DO UPDATE SET
    shell_llcs = excluded.shell_llcs,
    codenames = excluded.codenames,
    annual_capex_billions = excluded.annual_capex_billions,
    active_markets = excluded.active_markets
`);

let n = 0;
for (const op of OPERATORS) {
  upsert.run(
    op.name,
    JSON.stringify(op.shell_llcs),
    JSON.stringify(op.codenames),
    op.annual_capex_billions ?? null,
    op.active_markets ? JSON.stringify(op.active_markets) : null,
  );
  n++;
}
console.log(JSON.stringify({ upserted: n, total_in_db: (db.prepare("SELECT COUNT(*) c FROM operators").get() as any).c }));
