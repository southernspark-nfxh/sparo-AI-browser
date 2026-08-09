/** Feature flags for public Sparo build */
export function dxmEnabled(): boolean {
  return process.env.SPARO_ENABLE_DXM === "1";
}
