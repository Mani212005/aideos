/**
 * File Description: Node preload that makes the owner's voice the narrator of a child process the same way the npm test preload does for the test process itself: the default vcd address is answered by the deterministic fake voice service. A test that spawns the CLI passes this through NODE_OPTIONS (see voiceOfChoiceChildEnv), so a spawned run can never reach a real voice service.
 * Inputs and outputs: none -> installs the fake voice service in the process that loads it.
 * Used by: backend/testSupport/fakeVcd.ts (voiceOfChoiceChildEnv), backend/pipeline/pipeline.test.ts (CLI subprocess tests).
 */

import { installVoiceOfChoiceForTests } from "./fakeVcd";

installVoiceOfChoiceForTests();
