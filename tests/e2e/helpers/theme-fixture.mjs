export const themeFixture = (patch = {}) => ({
  palette: {
    background: '#f7f3e8', surface: '#fffdf8', text: '#172a23', link: '#1d5e4b',
    states: { Operational: '#14532d', 'Degraded performance': '#6b4000', 'Partially unavailable': '#743b00', 'Major outage': '#862828', 'Under maintenance': '#274574' },
  },
  font: 'inter', fontAsset: null, headerImage: null,
  headerLinks: [], footerLinks: [], headerHtml: '', footerHtml: '', groupsExpanded: true,
  hiddenUptimeComponents: [], historyDays: 90, css: 'h1 { letter-spacing: .015em; }',
  ...patch,
});

const settingKeys = ['pageName', 'tagline', 'accentColor', 'timezone', 'hostname', 'footerCreditEnabled', 'template', 'widgetAllowedOrigins', 'widgetAppearance', 'mailFromAddress', 'emailBranding', 'aiToneInstructions', 'wordingBlockedTerms', 'wordingFriendlyLength'];
export const settingsInput = settings => Object.fromEntries(settingKeys.map(key => [key, settings[key]]));
