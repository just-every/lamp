export const smsCountries = ["US", "CA", "GB", "AU", "DE", "FR", "IN", "JP", "NZ", "IE", "NL", "ES", "IT", "BR", "MX"] as const;
export type SmsCountry = typeof smsCountries[number];
const callingCodes: Record<SmsCountry, string> = { US:"1", CA:"1", GB:"44", AU:"61", DE:"49", FR:"33", IN:"91", JP:"81", NZ:"64", IE:"353", NL:"31", ES:"34", IT:"39", BR:"55", MX:"52" };
const canadianAreas = new Set("204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 450 468 474 506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905 942".split(" "));
const otherNanpAreas = new Set("242 246 264 268 284 345 441 473 649 658 664 721 758 767 784 809 829 849 868 869 876".split(" "));
export function validateSmsPhone(phone: string, countries: readonly string[] = ["US", "CA"]): string {
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || phone.startsWith("+1") && !/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(phone)) throw new Error("Enter a phone number in E.164 form, such as +12025550123.");
  if (phone.startsWith("+1")) {
    const area=phone.slice(2,5);
    const country=canadianAreas.has(area)?"CA":otherNanpAreas.has(area)?null:"US";
    if(!country||!countries.includes(country))throw new Error("The owner has not enabled this phone number's country.");
    return phone;
  }
  if (!smsCountries.some(country => countries.includes(country) && phone.startsWith(`+${callingCodes[country]}`))) throw new Error("The owner has not enabled this phone number's country.");
  return phone;
}
