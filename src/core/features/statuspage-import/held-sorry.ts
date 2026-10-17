/** Sorry subscribers held for cutover and never released are deleted, with their
 * addresses, this long after the reviewed dry run they came from. */
export const HELD_SORRY_DAYS = 30;
export const heldDeadline = (createdAt: string) => new Date(Date.parse(createdAt) + HELD_SORRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
