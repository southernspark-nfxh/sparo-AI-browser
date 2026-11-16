// 微信正文排版主题。改这里就能换整篇文章的样式（字号/行高/主色/圆角）。
// 参数取自 2026 年主流公众号排版规范：
//   正文 15px / 行高 1.75 / 段距 20px / 字距 0.5px / 颜色 #3f3f3f
//   标题 18-22px 加粗；引用左侧竖线 + 浅灰底；图片宽 100%、圆角 8px、上下留白
export const THEMES = {
  // 默认：深蓝主色 + 墨灰正文，偏"正规媒体"
  editorial: {
    accent: "#0F4C81",
    title: "#1a1a1a",
    body: "#3f3f3f",
    muted: "#8a8a8a",
    quoteBg: "#f7f7f7",
    quoteBorder: "#d9d9d9",
    rule: "#e6e6e6",
    bodySize: 15,
    lineHeight: 1.75,
    paraGap: 20,
    imgRadius: 8,
    letterSpacing: 0.5,
  },
  // 纯墨色：所有标题黑色，只靠粗细和间距分层
  ink: {
    accent: "#1a1a1a",
    title: "#111111",
    body: "#3f3f3f",
    muted: "#8a8a8a",
    quoteBg: "#f6f6f6",
    quoteBorder: "#dcdcdc",
    rule: "#e6e6e6",
    bodySize: 15,
    lineHeight: 1.75,
    paraGap: 20,
    imgRadius: 6,
    letterSpacing: 0.5,
  },
  // 微信绿：偏品牌、活泼
  green: {
    accent: "#07C160",
    title: "#1a1a1a",
    body: "#3f3f3f",
    muted: "#8a8a8a",
    quoteBg: "#f2fbf6",
    quoteBorder: "#bfe8d2",
    rule: "#e6e6e6",
    bodySize: 15,
    lineHeight: 1.75,
    paraGap: 20,
    imgRadius: 8,
    letterSpacing: 0.5,
  },
};

export function resolveTheme(name) {
  return THEMES[name] || THEMES.editorial;
}

export function themeNames() {
  return Object.keys(THEMES);
}
