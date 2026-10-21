/** Pages that sell, show or explain a product, or invite the reader to something, rather than being one of its
 * areas. Each kind is recognised by the words of the page's own name, whatever menu or directory files it. */

// A call to action asks the reader to do something now: a leading verb and its object ("Get in touch with sales",
// "Schedule a call", "Find a partner"). A product named by a single verb ("Build", "Chat") is not one.
const CALL_TO_ACTION = /^(get|talk|speak|chat|schedule|call|ask|apply|claim|buy|order|subscribe|upgrade|meet|visit|take|find|compare|calculate|estimate|check|test|contact|reach|connect|build|create|make|grow|save|switch|move|start|try|book|request|join|see|watch|learn|explore|discover|register|download|sign|log|read|view|shop|hire|tell)\s+(in|into|to|with|a|an|the|our|your|us|me|my|more|started|touch|help|free|now|today|out|up|back|on|it|this|that|what|how|why|all|every|any|one|demo|quote|price|pricing|sales|experts?|specialists?|partners?)\b/i;
// A question or an explainer is about the product, not one of its areas ("What's in the free tier?", "How it works").
const QUESTION = /\?$|^(what|why|how|who|when|where|which)\b/i;
// Dated occasions: launches, webinars, conferences and workshops ("Launch Week", "Webinare", "Upcoming events").
const EVENT = /\b(launch ?weeks?|conferences?|summits?|meetups?|hackathons?|keynotes?|roadshows?|workshops?|livestreams?)\b|\bwebinar|\b(upcoming|live|virtual|in-person|online|community|customer|partner|industry|our) events?$/i;
// Demos, trials and tours show a product ("Trials and demos", "Interactive demo", "Product tour").
const DEMO = /\b(demos?|trials?|test ?drives?)\b|\b(product|guided|virtual|interactive) tours?$/i;
// Free tools and the free tier: calculators, generators and checkers ("ROI Calculator", "Free Tools").
const FREE_TOOL = /(calculator|generator|checker|converter|estimator|grader|validator|picker|kalkulator|calculadora|calculateur|calcolatore|калькулятор)s?$|\bfree (tools?|templates?|resources|downloads?|courses?|tier|plans?|version)\b/iu;
// Catalogues of other parties' apps and partners ("Marketplace", "Partner Ecosystem").
const CATALOGUE = /\b(marketplace|ecosystem|app (store|directory))$/i;
// News and claims rather than names ("latest innovations", "Research customers faster", "Resolve queries 24/7").
const CLAIM = /^latest\b|\b(news|announcements?)$|\b(faster|better|easier|smarter|quicker|simpler|safer|cheaper)$|\b24\/7\b/i;
// An index of features or capabilities ("CDN Features", "Platform and Capabilities").
const FEATURE_INDEX = /\b(features|capabilities)$/i;
// Ways to join rather than products: partner, startup, beta and similar programmes, grants and fellowships
// ("Education Grant", "Startup-Programm"). A product for running programmes ("Loyalty programs") stays.
const PROGRAMME = /(^|\b(partner|affiliate|reseller|referral|ambassador|startup|start-up|beta|education|student|nonprofit|non-profit|developer|creator|expert|champion|community|channel|isv|alliance|insider)[-\s]?)program(m|me)?s?$|\b(grants?|scholarships?|fellowships?)\b|\b(accelerator|incubator)$/i;
// Solutions pages sort products by audience or need ("Midsize business solutions", "Custom Solutions").
const SOLUTIONS = /\bsolutions$/i;
// A single report is reading material ("The 2025 State of Observability report").
const REPORT = /\breport$/i;
// So is a Reports or Research page whose own description says analysts wrote it ("Analystenberichte und Studien").
const READING = /^(reports?|research|studies|insights|library)$/i;
const ANALYST = /\banal[yi]st/i;
// A description that introduces the page as a programme ("Orbit: The partner program for freelancers and agencies").
const DESCRIBED_PROGRAMME = /^(the|our|a|an)\s+([\p{L}'-]+\s+){0,2}program(m|me)?s?\b/iu;

/** Whether a link's name, or its own description, says the page is not a product area. */
export const marketingPage = (name: string, description: string) =>
  [CALL_TO_ACTION, QUESTION, EVENT, DEMO, FREE_TOOL, CATALOGUE, CLAIM, FEATURE_INDEX, PROGRAMME, SOLUTIONS, REPORT].some(kind => kind.test(name))
  || READING.test(name) && ANALYST.test(description) || DESCRIBED_PROGRAMME.test(description);
