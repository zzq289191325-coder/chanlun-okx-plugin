const PREFIX = "[chanlun-okx]";

export const logger = {
  warn(message: string, payload?: unknown) {
    console.warn(PREFIX, message, payload ?? "");
  },
  error(message: string, payload?: unknown) {
    console.error(PREFIX, message, payload ?? "");
  },
};
