import { crc32, deflateSync } from "node:zlib";

// A real-size, synthetic brand banner, with no metadata or third-party content.
export function themeHeaderImage() {
  const width = 960, height = 160;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 3) + 1 + x * 3;
    pixels[offset] = 22 + Math.round(x / width * 20);
    pixels[offset + 1] = 64 + Math.round(y / height * 36);
    pixels[offset + 2] = 54 + Math.round(x / width * 18);
  }
  const chunk = (kind, data) => {
    const name = Buffer.from(kind), size = Buffer.alloc(4), check = Buffer.alloc(4);
    size.writeUInt32BE(data.length); check.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, check]);
  };
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

export function themeSettings(defaults) {
  return {
    ...defaults,
    palette: { background: "#f4f4f4", surface: "#e9f2ec", text: "#172d24", link: "#195138", operational: "#185a3b", degraded: "#745000", partial: "#884500", major: "#a12619", maintenance: "#354d81" },
    font: "serif", headerImage: false,
    headerLinks: [{ label: "Customer support", href: "https://example.test/support" }],
    footerLinks: [{ label: "Service history", href: "/history" }],
    headerHtml: '<nav class="owner-note"><p>Service updates from the Atlas team.</p></nav>',
    footerHtml: '<p><strong>Always here to help.</strong></p>',
    groupsCollapsed: true, hiddenUptimeComponentIds: ["01J00000000000000000000010"], historyDays: 14,
    customCss: '.owner-note { letter-spacing: 0.4px } .theme-footer { padding: 17px } @media print { .theme-footer { break-inside: avoid } } @page { margin: 1cm }',
  };
}
