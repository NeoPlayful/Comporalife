import type { TFunction } from 'i18next';
import { ApiError } from './client';

/**
 * 把后端错误翻译成当前语言。
 * 优先按错误码查表；未知错误码回退到服务端 message，保证新接口不会无提示。
 */
export function translateError(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    const key = `errors:${error.code}`;
    const params = error.params ?? {};
    const translated = t(key, { ...params, defaultValue: '' });

    if (translated) return translated;

    if (error.message) return error.message;
    return t('common:state.load_failed');
  }

  return t('common:network_error');
}
