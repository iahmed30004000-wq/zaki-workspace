/**
 * One chat upload with a progress callback (0..100). `fetch` cannot report upload progress, so this
 * is the one place the chat uses XMLHttpRequest. It resolves with the server's JSON on 2xx and
 * rejects with the server's dictionary key (or "chat.f.upload_failed") otherwise.
 */
export function uploadWithProgress(
  url: string,
  form: FormData,
  onProgress: (percent: number) => void,
  makeXhr: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = makeXhr();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = xhr.responseText ? (JSON.parse(xhr.responseText) as Record<string, unknown>) : {};
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve(body);
      } else {
        // the API answers { error: <code>, message: <dictionary key> }: the key says what went wrong
        const message = body["message"];
        reject(new Error(typeof message === "string" && (message.startsWith("chat.") || message.startsWith("stories.")) ? message : "chat.f.upload_failed"));
      }
    };
    xhr.onerror = () => reject(new Error("chat.f.upload_failed"));
    xhr.send(form);
  });
}
