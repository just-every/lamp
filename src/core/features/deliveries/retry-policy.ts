// Five doubling intervals fill one hour. Round cumulative deadlines so the last
// retry lands at exactly one hour, without losing milliseconds at each step.
const deadlines = [1, 3, 7, 15, 31].map(weight => Math.round(3_600_000 * weight / 31));
export const RETRY_DELAYS_MS = deadlines.map((deadline, index) => deadline - (deadlines[index - 1] ?? 0));
