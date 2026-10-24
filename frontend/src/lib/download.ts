/**
 * 带鉴权头的文件下载。
 *
 * `<a download>` 不会携带 Authorization，因此必须先 fetch 成 Blob 再触发保存。
 * 文件名优先取 RFC 5987 的中文名，解码失败时退回 ASCII 名，最后才用调用方给的默认名。
 */
export async function downloadUrlAsFile(
  url: string,
  accessToken: string | null,
  fallbackName: string,
): Promise<void> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (!response.ok) {
    let message = `下载失败（${response.status}）`;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      // 非 JSON 响应保留默认文案
    }
    throw new Error(message);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const asciiMatch = disposition.match(/filename="([^"]+)"/i);

  let filename = asciiMatch?.[1] ?? fallbackName;
  if (utf8Match?.[1]) {
    try {
      filename = decodeURIComponent(utf8Match[1]);
    } catch {
      // 保留 ASCII 回退名
    }
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
