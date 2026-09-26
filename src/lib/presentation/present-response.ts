import { formatIssuedAt } from "./format";
import type { PresentationResponse, PresentationResponseAction } from "./types";

export function presentResponse(response: {
  action: PresentationResponseAction;
  respondentName: string;
  respondedAt: Date;
  message: string | null;
}): PresentationResponse {
  return {
    action: response.action,
    respondentName: response.respondentName,
    respondedAtLabel: formatIssuedAt(response.respondedAt),
    message: response.message,
  };
}
