import { NextResponse } from "next/server";
import { z } from "zod";

export const INVALID_BODY_MESSAGE = "Corpo da requisição inválido.";

/**
 * 400 for a failed safeParse. Field violations keep `{ errors: fieldErrors }`; when there are none
 * (e.g. the body was not valid JSON and parsed as null) the error goes under `form`, which api-client shows.
 */
export function validationError(error: z.ZodError) {
  const fieldErrors = z.flattenError(error).fieldErrors;
  const errors = Object.keys(fieldErrors).length > 0 ? fieldErrors : { form: [INVALID_BODY_MESSAGE] };
  return NextResponse.json({ errors }, { status: 400 });
}
