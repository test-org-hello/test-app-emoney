import { useTranslations } from 'next-intl';
import { ApiRequestError } from './api-error';

/**
 * Error text for the UI: known API error codes are translated, anything else
 * (e.g. validation details from the backend) falls back to the raw message.
 */
export function useErrorMessage() {
  const t = useTranslations('errors');
  return (e: unknown): string => {
    if (e instanceof ApiRequestError && t.has(e.code as never)) {
      return t(e.code as never);
    }
    return e instanceof Error ? e.message : String(e);
  };
}
