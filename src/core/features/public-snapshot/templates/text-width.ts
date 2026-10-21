/** Inter's advance widths in thousandths of an em for printable ASCII, space to tilde, measured in a browser from the
 *  bundled face (../fonts/inter-latin.woff2). The stylesheet places Regions map cards and heatmap callouts without a
 *  browser, so it sizes their text from these; any other character counts as Inter's widest glyph. */
const advances = {
  400: [282, 288, 466, 634, 642, 982, 645, 300, 365, 365, 501, 662, 289, 460, 289, 361, 631, 407, 610, 618, 646, 594, 621, 566, 619, 621, 289, 302, 662, 662, 662, 512, 966, 690, 655, 731, 722, 602, 591, 747, 744, 269, 571, 672, 566, 904, 754, 765, 639, 765, 644, 642, 646, 745, 690, 986, 683, 679, 629, 365, 361, 365, 472, 457, 323, 562, 613, 572, 613, 584, 371, 614, 592, 243, 243, 549, 243, 876, 591, 600, 613, 613, 377, 528, 328, 592, 563, 819, 546, 563, 553, 427, 333, 427, 662],
  500: [267, 305, 495, 639, 646, 994, 654, 313, 369, 369, 521, 668, 304, 463, 304, 370, 646, 415, 617, 627, 657, 603, 630, 572, 630, 630, 304, 316, 668, 668, 668, 528, 983, 709, 657, 734, 722, 604, 590, 748, 745, 273, 576, 688, 566, 913, 757, 767, 642, 769, 648, 646, 653, 741, 709, 1003, 701, 697, 641, 369, 370, 369, 477, 463, 337, 568, 619, 578, 619, 588, 380, 620, 602, 252, 252, 560, 252, 889, 602, 605, 619, 619, 387, 539, 341, 602, 575, 829, 558, 576, 560, 441, 346, 441, 668],
  600: [252, 322, 523, 644, 651, 1005, 663, 326, 374, 374, 540, 674, 319, 466, 319, 379, 660, 424, 624, 637, 667, 613, 640, 577, 641, 640, 319, 330, 674, 674, 674, 544, 1000, 728, 660, 737, 723, 606, 589, 750, 746, 277, 580, 704, 566, 923, 760, 769, 645, 773, 653, 651, 661, 737, 728, 1021, 720, 714, 653, 374, 379, 374, 482, 470, 352, 575, 625, 583, 625, 592, 389, 626, 613, 262, 262, 570, 262, 901, 612, 609, 625, 625, 398, 550, 354, 613, 588, 840, 569, 589, 566, 455, 359, 455, 674],
} as const;

const WIDEST = 1021;

/** The width of one line of text in Inter, in pixels, rounded up; kerning only ever narrows it. */
export function textWidth(text: string, size: number, weight: keyof typeof advances) {
  const table = advances[weight];
  let units = 0;
  for (const character of text) units += table[(character.codePointAt(0) ?? 0) - 32] ?? WIDEST;
  return Math.ceil((units * size) / 1000);
}
