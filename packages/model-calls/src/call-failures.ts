import { APICallError, LoadAPIKeyError, RetryError } from 'ai';

// An AI SDK error class whose instances are a failure of one answer, such as
// NoObjectGeneratedError of generateText or
// Experimental_DecisionRefusalError of experimental_decide.
export type AnswerError = {
  isInstance(error: unknown): error is Error;
};

// Which failures of a model call are the failure of one item, a page or an
// email, and which stop the whole run.
export class CallFailures {
  readonly #answerErrors: readonly AnswerError[];

  constructor(...answerErrors: readonly AnswerError[]) {
    this.#answerErrors = answerErrors;
  }

  // Whether the call failed for its credential: it found no key, or the API
  // rejected the one it sent with a 401. Every other call fails alike, so an
  // app that hears it stops.
  static isCredentialError(error: unknown): boolean {
    if (LoadAPIKeyError.isInstance(error)) return true;
    const call = RetryError.isInstance(error) ? error.lastError : error;
    return APICallError.isInstance(call) && call.statusCode === 401;
  }

  // The reason that the call failed for its item: the message of an answer
  // error, or of the API error of a call that failed after the AI SDK's
  // retries. A 401 throws: every call would fail, so the run fails. Every
  // other error throws too, a stop among them.
  reason(error: unknown): string {
    for (const answerError of this.#answerErrors)
      if (answerError.isInstance(error)) return error.message;
    // A RetryError holds the failure of each call; the last one is why.
    const call = RetryError.isInstance(error) ? error.lastError : error;
    if (APICallError.isInstance(call) && !CallFailures.isCredentialError(call))
      return call.message;
    throw error;
  }
}
