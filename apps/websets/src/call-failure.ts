import {
  APICallError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
} from 'ai';

// A model call that failed after the AI SDK's retries is the failure of
// that call: one page's judgment or field, or one search. A rejected token
// is no failure of one call, since every call would fail, so it propagates,
// as does a stop. As startup-credits' ProgramOffers decides
// (docs/copied-code.md).
export function callFailure(error: unknown): { readonly error: string } {
  if (
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error)
  ) {
    return { error: error.message };
  }
  const call = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(call) && call.statusCode !== 401) {
    return { error: call.message };
  }
  throw error;
}
