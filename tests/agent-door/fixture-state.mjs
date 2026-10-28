// Fresh verifier provider credentials stay in this Node process, never a route or file.
let fixture;
export const retainFixture = value => { fixture = value; };
export const nativeFixture = () => {
  if (!fixture) throw new Error('Native owner fixture has not completed');
  return fixture;
};
