/**
 * The shared baseline pack does not import Lamp services or repositories.  A
 * seed supplies its running Worker through this small HTTP seam instead.
 */
export function workerBaselineDriver(fetchImplementation) {
  return {
    fetch(request) {
      return Promise.resolve(fetchImplementation(request));
    },
  };
}
