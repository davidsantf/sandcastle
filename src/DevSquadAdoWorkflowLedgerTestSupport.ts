import type {
  DevSquadAdoLedgerResult,
  DevSquadAdoWorkflowLedger,
  OpenDevSquadAdoWorkflowLedgerInput,
} from "./DevSquadAdoWorkflowLedger.js";
import {
  makeTrustedTestLedgerPlatform,
  noLedgerPersistenceFaults,
} from "./DevSquadAdoWorkflowLedgerPlatform.js";
import type {
  LedgerPersistenceFaultService,
  LedgerPersistencePoint,
} from "./DevSquadAdoWorkflowLedgerPlatform.js";
import {
  openDevSquadAdoWorkflowLedgerWithRuntime,
  type LedgerRuntimeService,
} from "./DevSquadAdoWorkflowLedgerStorage.js";

export const makeLedgerTestRuntime = (
  now: () => Date,
  faults: LedgerPersistenceFaultService,
): LedgerRuntimeService => ({
  now,
  platform: makeTrustedTestLedgerPlatform(faults),
});

export const openTestDevSquadAdoWorkflowLedger = (
  input: OpenDevSquadAdoWorkflowLedgerInput,
): Promise<DevSquadAdoLedgerResult<DevSquadAdoWorkflowLedger>> =>
  openDevSquadAdoWorkflowLedgerWithRuntime(
    input,
    makeLedgerTestRuntime(() => new Date(), noLedgerPersistenceFaults),
  );

export const openTestDevSquadAdoWorkflowLedgerWithClock = (
  input: OpenDevSquadAdoWorkflowLedgerInput,
  now: () => Date,
): Promise<DevSquadAdoLedgerResult<DevSquadAdoWorkflowLedger>> =>
  openDevSquadAdoWorkflowLedgerWithRuntime(
    input,
    makeLedgerTestRuntime(now, noLedgerPersistenceFaults),
  );

export const interruptPersistenceAt = (
  selected: LedgerPersistencePoint,
): LedgerPersistenceFaultService => ({
  hit(point) {
    if (point === selected)
      throw new Error("injected-persistence-interruption");
  },
});
