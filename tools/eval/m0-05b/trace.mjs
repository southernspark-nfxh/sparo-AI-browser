import { EVALUATION_MODE, FACILITY_VERSION } from "./version.mjs";

export function createTrace(missionId) {
  const events = [];
  let n = 0;
  return {
    events,
    push(name, payload = {}) {
      events.push({
        schemaVersion: 1,
        eventId: `${missionId}-e${String(++n).padStart(3, "0")}`,
        missionId,
        time: new Date().toISOString(),
        runtimeVersion: `eval:${FACILITY_VERSION}`,
        evaluationMode: EVALUATION_MODE,
        productionV2: false,
        name,
        ...payload,
      });
    },
  };
}
