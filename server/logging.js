const EVENTS = new Set([
  "database_connection_failed",
  "database_query_failed",
  "author_list_query_failed",
  "shutdown_failed",
]);

const ERROR_TYPES = new Set([
  "Error", "TypeError", "RangeError",
  "MongoError", "MongoServerError", "MongoNetworkError", "MongoNetworkTimeoutError",
  "MongoServerSelectionError", "MongoWaitQueueTimeoutError", "MongoParseError",
  "MongoInvalidArgumentError", "MongoRuntimeError", "MongoOperationTimeoutError",
]);

const SYSTEM_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "EPIPE", "ECONNABORTED", "ERR_SERVER_NOT_RUNNING",
]);

const logError = (event, error) => {
  // Only fixed categories and safe codes enter logs. Messages, stacks, URIs,
  // request data and arbitrary driver metadata may contain private information.
  const entry = { event: EVENTS.has(event) ? event : "operation_failed", type: "Error" };
  try {
    const name = error?.name;
    const code = error?.code;
    if (ERROR_TYPES.has(name)) entry.type = name;
    if (
      (Number.isInteger(code) && code >= 0 && code <= 2_147_483_647) ||
      SYSTEM_CODES.has(code)
    ) {
      entry.code = code;
    }
  } catch {
    // Malformed error metadata must not break the error response.
  }
  console.error(JSON.stringify(entry));
};

module.exports = { logError };
