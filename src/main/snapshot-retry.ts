export type SnapshotCapture = {
  url?: string;
  elements?: unknown[];
};

/** 有地址但一个可点元素都没有，才值得在工具内部再抓一次。空白页不算。 */
export function snapshotLooksEmpty(snap: SnapshotCapture): boolean {
  const count = snap.elements?.length || 0;
  const url = String(snap.url || "");
  return count === 0 && url !== "" && url !== "about:blank";
}

/** 空快照只重抓一次。重抓仍是 0 也原样返回，不改写成页面为空。 */
export async function recaptureIfEmpty<T extends SnapshotCapture>(
  collect: () => Promise<T>,
  wait: (ms: number) => Promise<void>,
): Promise<{ snap: T; retried: boolean }> {
  const first = await collect();
  if (!snapshotLooksEmpty(first)) return { snap: first, retried: false };
  await wait(600);
  const second = await collect();
  return { snap: second, retried: true };
}
