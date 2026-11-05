// supabase/functions/ai-chat/retrieval/sources.ts
// Trusted sites for news and fresh data, by country and by field. A news
// search is first limited to these sites (see tools/web.ts) and only opens up
// to the whole web when they give too little, so a list here is a preference,
// never a wall: a wrong or dead address costs nothing but a missed boost.
//
// HOW TO EDIT: add or remove an address inside a list. Write the bare site
// name only (no https://, no path, no www). Country keys are ISO 3166-1
// alpha-2 codes in capitals; GLOBAL is the world list for subjects that belong
// to no country. A country that has no list for a field uses its `general`
// list. A site may appear in several lists. Keep each list short (at most
// about ten sites): a long list brings back the noise it was made to remove.
//
// "Trusted" here means well known and well updated, not neutral: many outlets
// belong to a state or to a party. For that reason a list should mix
// independent and international outlets with local ones where they exist, and
// the app counts how many different sites carry one story (reported_by).

export type Topic =
  | "general"
  | "sports"
  | "economy"
  | "technology"
  | "science"
  | "health"
  | "entertainment";

export const TOPICS: readonly Topic[] = [
  "general",
  "sports",
  "economy",
  "technology",
  "science",
  "health",
  "entertainment",
];

type CountrySources = Partial<Record<Topic, readonly string[]>> & {
  readonly general: readonly string[];
};

export const SOURCES: Readonly<Record<string, CountrySources>> = {
  GLOBAL: {
    general: ["reuters.com", "apnews.com", "bbc.com", "aljazeera.com", "theguardian.com", "france24.com", "dw.com"],
    sports: ["espn.com", "bbc.com", "skysports.com", "goal.com", "fifa.com", "olympics.com", "eurosport.com"],
    economy: ["reuters.com", "bloomberg.com", "ft.com", "cnbc.com", "wsj.com", "economist.com"],
    technology: ["theverge.com", "techcrunch.com", "arstechnica.com", "wired.com", "engadget.com"],
    science: ["nature.com", "science.org", "sciencedaily.com", "newscientist.com", "scientificamerican.com"],
    health: ["who.int", "nih.gov", "cdc.gov", "mayoclinic.org", "medlineplus.gov", "nhs.uk"],
    entertainment: ["variety.com", "hollywoodreporter.com", "deadline.com", "rollingstone.com"],
  },
  IR: {
    general: ["irna.ir", "isna.ir", "tasnimnews.com", "mehrnews.com", "khabaronline.ir", "hamshahrionline.ir", "entekhab.ir", "bbc.com", "iranintl.com", "radiofarda.com"],
    sports: ["varzesh3.com", "khabarvarzeshi.com", "football360.ir", "isna.ir", "tasnimnews.com", "mehrnews.com", "irna.ir", "hamshahrionline.ir"],
    economy: ["donya-e-eqtesad.com", "eghtesadnews.com", "tejaratnews.com", "eghtesadonline.com", "ecoiran.com", "isna.ir", "irna.ir"],
    technology: ["zoomit.ir", "digiato.com", "itiran.com", "isna.ir"],
  },
  AF: {
    general: ["tolonews.com", "pajhwok.com", "ariananews.af", "8am.media", "bbc.com"],
  },
  US: {
    general: ["nytimes.com", "washingtonpost.com", "apnews.com", "npr.org", "cnn.com", "usatoday.com", "reuters.com", "nbcnews.com", "cbsnews.com"],
    sports: ["espn.com", "cbssports.com", "nbcsports.com", "si.com", "bleacherreport.com", "apnews.com"],
    economy: ["wsj.com", "bloomberg.com", "cnbc.com", "forbes.com", "marketwatch.com", "reuters.com"],
    technology: ["theverge.com", "techcrunch.com", "arstechnica.com", "wired.com", "cnet.com"],
    science: ["nature.com", "science.org", "sciencedaily.com", "scientificamerican.com"],
    health: ["cdc.gov", "nih.gov", "mayoclinic.org", "statnews.com", "healthline.com"],
    entertainment: ["variety.com", "hollywoodreporter.com", "deadline.com", "rollingstone.com"],
  },
  GB: {
    general: ["bbc.co.uk", "bbc.com", "theguardian.com", "telegraph.co.uk", "independent.co.uk", "news.sky.com", "thetimes.co.uk", "ft.com"],
    sports: ["bbc.com", "skysports.com", "theguardian.com", "telegraph.co.uk", "standard.co.uk"],
    economy: ["ft.com", "economist.com", "thisismoney.co.uk", "cityam.com", "bbc.com"],
    technology: ["theregister.com", "techradar.com", "wired.com", "bbc.com"],
    health: ["nhs.uk", "bbc.com", "theguardian.com"],
  },
  CA: {
    general: ["cbc.ca", "theglobeandmail.com", "thestar.com", "nationalpost.com", "ctvnews.ca"],
    sports: ["tsn.ca", "sportsnet.ca", "cbc.ca"],
    economy: ["theglobeandmail.com", "financialpost.com", "bnnbloomberg.ca"],
  },
  AU: {
    general: ["abc.net.au", "smh.com.au", "theage.com.au", "theaustralian.com.au", "news.com.au"],
    sports: ["foxsports.com.au", "abc.net.au", "wwos.nine.com.au"],
    economy: ["afr.com", "abc.net.au", "smh.com.au"],
  },
  ES: {
    general: ["elpais.com", "rtve.es", "elmundo.es", "efe.com", "lavanguardia.com", "abc.es", "20minutos.es"],
    sports: ["marca.com", "as.com", "mundodeportivo.com", "sport.es", "rtve.es"],
    economy: ["expansion.com", "cincodias.elpais.com", "eleconomista.es", "elconfidencial.com"],
    technology: ["xataka.com", "genbeta.com", "hipertextual.com"],
  },
  MX: {
    general: ["eluniversal.com.mx", "milenio.com", "jornada.com.mx", "excelsior.com.mx", "informador.mx"],
    sports: ["record.com.mx", "mediotiempo.com", "tudn.com", "esto.com.mx"],
    economy: ["eleconomista.com.mx", "elfinanciero.com.mx"],
  },
  AR: {
    general: ["clarin.com", "lanacion.com.ar", "infobae.com", "pagina12.com.ar"],
    sports: ["ole.com.ar", "tycsports.com", "clarin.com"],
    economy: ["ambito.com", "cronista.com", "lanacion.com.ar"],
  },
  DE: {
    general: ["tagesschau.de", "spiegel.de", "zeit.de", "sueddeutsche.de", "faz.net", "dw.com"],
    sports: ["kicker.de", "sportschau.de", "sport1.de"],
    economy: ["handelsblatt.com", "wiwo.de", "manager-magazin.de"],
    technology: ["heise.de", "golem.de", "t3n.de"],
    health: ["apotheken-umschau.de", "gesundheitsinformation.de"],
  },
  FR: {
    general: ["lemonde.fr", "lefigaro.fr", "francetvinfo.fr", "liberation.fr", "rfi.fr", "france24.com"],
    sports: ["lequipe.fr", "francetvinfo.fr", "rmcsport.bfmtv.com"],
    economy: ["lesechos.fr", "latribune.fr", "bfmtv.com"],
    technology: ["numerama.com", "01net.com", "frandroid.com"],
  },
  IT: {
    general: ["ansa.it", "repubblica.it", "corriere.it", "ilsole24ore.com", "lastampa.it"],
    sports: ["gazzetta.it", "corrieredellosport.it", "tuttosport.com"],
    economy: ["ilsole24ore.com", "milanofinanza.it"],
    technology: ["hwupgrade.it", "punto-informatico.it"],
  },
  BR: {
    general: ["globo.com", "folha.uol.com.br", "estadao.com.br", "uol.com.br", "cnnbrasil.com.br"],
    sports: ["globo.com", "lance.com.br", "espn.com.br", "uol.com.br"],
    economy: ["globo.com", "infomoney.com.br", "exame.com", "valor.globo.com"],
  },
  PT: {
    general: ["publico.pt", "rtp.pt", "expresso.pt", "observador.pt"],
    sports: ["record.pt", "abola.pt", "ojogo.pt"],
  },
  RU: {
    general: ["tass.ru", "ria.ru", "rbc.ru", "kommersant.ru", "interfax.ru", "vedomosti.ru", "lenta.ru", "iz.ru"],
    sports: ["sport-express.ru", "championat.com", "sports.ru", "matchtv.ru"],
    economy: ["rbc.ru", "kommersant.ru", "vedomosti.ru", "interfax.ru"],
    technology: ["habr.com", "ixbt.com", "3dnews.ru"],
  },
  UA: {
    general: ["pravda.com.ua", "unian.ua", "ukrinform.ua", "suspilne.media", "ukrinform.net"],
    sports: ["sport.ua", "championat.com"],
  },
  TR: {
    general: ["aa.com.tr", "trthaber.com", "hurriyet.com.tr", "ntv.com.tr", "milliyet.com.tr", "sabah.com.tr", "haberturk.com"],
    sports: ["fanatik.com.tr", "fotomac.com.tr", "sporx.com", "ntvspor.net", "trtspor.com.tr"],
    economy: ["bloomberght.com", "dunya.com", "ekonomim.com"],
    technology: ["donanimhaber.com", "webtekno.com", "shiftdelete.net"],
  },
  SA: {
    general: ["aljazeera.net", "alarabiya.net", "skynewsarabia.com", "aawsat.com", "okaz.com.sa", "alriyadh.com", "spa.gov.sa"],
    sports: ["kooora.com", "yallakora.com", "alriyadh.com"],
  },
  EG: {
    general: ["ahram.org.eg", "youm7.com", "almasryalyoum.com", "aljazeera.net", "alarabiya.net"],
    sports: ["kooora.com", "yallakora.com", "filgoal.com", "youm7.com"],
  },
  AE: {
    general: ["alkhaleej.ae", "albayan.ae", "gulfnews.com", "thenationalnews.com", "wam.ae"],
    economy: ["gulfnews.com", "thenationalnews.com", "arabianbusiness.com"],
  },
  IN: {
    general: ["thehindu.com", "indianexpress.com", "ndtv.com", "hindustantimes.com", "timesofindia.indiatimes.com", "indiatoday.in", "theprint.in", "bhaskar.com", "jagran.com", "amarujala.com", "aajtak.in"],
    sports: ["espncricinfo.com", "cricbuzz.com", "sportstar.thehindu.com", "sportskeeda.com", "timesofindia.indiatimes.com"],
    economy: ["economictimes.indiatimes.com", "livemint.com", "business-standard.com", "moneycontrol.com", "financialexpress.com"],
    technology: ["gadgets360.com", "91mobiles.com", "digit.in"],
  },
  PK: {
    general: ["dawn.com", "thenews.com.pk", "geo.tv", "tribune.com.pk"],
    sports: ["dawn.com", "geo.tv", "cricbuzz.com"],
  },
  CN: {
    general: ["xinhuanet.com", "news.cn", "chinadaily.com.cn", "people.com.cn", "cctv.com", "thepaper.cn", "sina.com.cn", "163.com"],
    sports: ["sports.sina.com.cn", "sports.163.com", "sports.qq.com", "dongqiudi.com", "hupu.com"],
    economy: ["caixin.com", "yicai.com", "cnstock.com", "21jingji.com", "eastmoney.com"],
    technology: ["36kr.com", "ithome.com", "ifanr.com"],
  },
  JP: {
    general: ["nhk.or.jp", "asahi.com", "yomiuri.co.jp", "mainichi.jp", "nikkei.com", "kyodonews.net", "jiji.com"],
    sports: ["sponichi.co.jp", "nikkansports.com", "sanspo.com", "soccer-king.jp"],
    economy: ["nikkei.com", "toyokeizai.net", "diamond.jp"],
    technology: ["itmedia.co.jp", "impress.co.jp", "gigazine.net"],
  },
  KR: {
    general: ["yna.co.kr", "chosun.com", "joongang.co.kr", "hani.co.kr", "kbs.co.kr"],
    sports: ["osen.co.kr", "chosun.com", "donga.com", "yna.co.kr"],
    economy: ["hankyung.com", "mk.co.kr", "edaily.co.kr"],
    technology: ["zdnet.co.kr", "etnews.com"],
  },
  ID: {
    general: ["kompas.com", "detik.com", "tempo.co", "antaranews.com"],
    sports: ["bola.com", "kompas.com", "detik.com"],
  },
  VN: {
    general: ["vnexpress.net", "tuoitre.vn", "thanhnien.vn", "vietnamnet.vn"],
  },
  TH: {
    general: ["bangkokpost.com", "nationthailand.com", "thaipbs.or.th"],
  },
  PH: {
    general: ["inquirer.net", "gmanetwork.com", "philstar.com", "rappler.com"],
  },
  NG: {
    general: ["punchng.com", "vanguardngr.com", "guardian.ng", "premiumtimesng.com"],
    sports: ["completesports.com", "punchng.com"],
  },
  ZA: {
    general: ["news24.com", "iol.co.za", "timeslive.co.za", "dailymaverick.co.za"],
    sports: ["supersport.com", "news24.com"],
  },
  KE: {
    general: ["nation.africa", "standardmedia.co.ke", "the-star.co.ke"],
  },
  IL: {
    general: ["haaretz.com", "timesofisrael.com", "jpost.com", "ynetnews.com"],
  },
};

// Country codes people and models write that differ from ISO 3166-1.
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  UK: "GB",
  EN: "GB",
  USA: "US",
  UAE: "AE",
  WORLD: "GLOBAL",
  INTERNATIONAL: "GLOBAL",
  INT: "GLOBAL",
};

function countryKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const code = value.trim().toUpperCase();

  return COUNTRY_ALIASES[code] ?? code;
}

function topicKey(value: unknown): Topic {
  const topic = typeof value === "string" ? value.trim().toLowerCase() : "";

  return (TOPICS as readonly string[]).includes(topic)
    ? (topic as Topic)
    : "general";
}

// The sites to try first for this country and field, or null when the app has
// no list for the country (the search then simply runs over the whole web).
export function preferredDomains(
  country: unknown,
  topic: unknown,
): readonly string[] | null {
  const key = countryKey(country);

  if (key === null) {
    return null;
  }

  const sources = SOURCES[key];

  if (!sources) {
    return null;
  }

  const list = sources[topicKey(topic)] ?? sources.general;

  return list.length > 0 ? list : null;
}
