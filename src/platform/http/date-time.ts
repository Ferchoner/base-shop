/** A date and time with its offset, so the instant never depends on the server's time zone. */
export const DATE_TIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** The message of a value that is not a date and time with its offset, for `@Matches(DATE_TIME_WITH_OFFSET, …)`. */
export const WITH_OFFSET = {
  context: { message: 'Debe ser fecha y hora con zona horaria.' },
};
