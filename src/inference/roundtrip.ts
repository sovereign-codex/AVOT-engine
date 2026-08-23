import { executeInferencePlan, InferenceRuntimeAdapter } from "./adapter.js";
import {
  InferenceCapability,
  SovereignInferenceRequest,
} from "./contracts.js";
import { buildInferenceReturnPath, InferenceReturnPath } from "./return-path.js";
import { routeInferenceRequest } from "./router.js";

export interface SovereignInferenceRoundTrip {
  request: SovereignInferenceRequest;
  return_path: InferenceReturnPath;
}

export async function runSovereignInferenceRoundTrip(
  request: SovereignInferenceRequest,
  capabilities: InferenceCapability[],
  adapters: InferenceRuntimeAdapter[],
): Promise<SovereignInferenceRoundTrip> {
  const plan = routeInferenceRequest(request, capabilities);
  const result = await executeInferencePlan(request, plan, adapters);
  const returnPath = buildInferenceReturnPath(request, plan, result);

  return {
    request,
    return_path: returnPath,
  };
}
