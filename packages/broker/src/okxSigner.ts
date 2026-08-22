import { createHmac } from "node:crypto";

export interface OkxCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export function signOkxRequest(timestamp: string, method: string, requestPath: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}${method.toUpperCase()}${requestPath}${body}`).digest("base64");
}

export function redactCredentialText(value: string, credentials: OkxCredentials): string {
  return [credentials.apiKey, credentials.secret, credentials.passphrase].reduce((result, secret) => secret ? result.replaceAll(secret, "[REDACTED]") : result, value);
}
