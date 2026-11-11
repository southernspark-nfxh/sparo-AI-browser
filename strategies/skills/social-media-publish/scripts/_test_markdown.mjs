// 排版转换自检：Markdown 语法不能漏成字符
import { toParagraphHtml } from "./article.mjs";

const cases = [
  { name: "首行重复标题被去掉", md: "# 我的标题\n\n正文第一段。", opts: { title: "我的标题" }, want: "<p>正文第一段。</p>", not: ["#"], },
  { name: "首行标题不等于 title 时保留为 h2", md: "# 另一个标题\n\n正文。", opts: { title: "我的标题" }, want: "<h2>另一个标题</h2>" },
  { name: "## 转 h3", md: "## 【血战湘江】", opts: {}, want: "<h3>【血战湘江】</h3>", not: ["##"] },
  { name: "加粗", md: '**"壮哉，二十二勇士！"**', opts: {}, want: '<p><strong>&quot;壮哉，二十二勇士！&quot;</strong></p>', not: ["**"] },
  { name: "斜体星号", md: "*斜体文字*", opts: {}, want: "<p><em>斜体文字</em></p>", not: ["*"] },
  { name: "斜体下划线", md: "_斜体文字_", opts: {}, want: "<p><em>斜体文字</em></p>" },
  { name: "行内粗斜混排", md: "他说：**必须**走，*没有*退路", opts: {}, want: "<p>他说：<strong>必须</strong>走，<em>没有</em>退路</p>" },
  { name: "删除线", md: "~~删掉~~", opts: {}, want: "<p><del>删掉</del></p>" },
  { name: "行内代码", md: "用 `npm run dist` 打包", opts: {}, want: "<p>用 <code>npm run dist</code> 打包</p>" },
  { name: "无序列表", md: "- 第一条\n- 第二条", opts: {}, want: "<ul><li>第一条</li><li>第二条</li></ul>" },
  { name: "有序列表", md: "1. 第一\n2. 第二", opts: {}, want: "<ol><li>第一</li><li>第二</li></ol>" },
  { name: "引用", md: "> 一句引文", opts: {}, want: "<blockquote>一句引文</blockquote>" },
  { name: "分隔线", md: "上\n\n---\n\n下", opts: {}, want: "<hr>" },
  { name: "外链只留文字", md: "看[这里](https://example.com)就行", opts: {}, want: "<p>看这里就行</p>" },
  { name: "正文图片语法丢掉", md: "前\n\n![图](local.png)\n\n后", opts: {}, want: "<p>前</p><p>后</p>", not: ["![", "local.png"] },
  { name: "HTML 特殊字符转义", md: "1 < 2 & 3 > 2", opts: {}, want: "<p>1 &lt; 2 &amp; 3 &gt; 2</p>" },
  { name: "软换行并段", md: "第一行\n第二行", opts: {}, want: "<p>第一行<br>第二行</p>" },
  { name: "普通两段", md: "第一段\n\n第二段", opts: {}, want: "<p>第一段</p><p>第二段</p>" },
  { name: "列表后接正文", md: "- 项\n\n正文", opts: {}, want: "<ul><li>项</li></ul><p>正文</p>" },
];

let bad = 0;
for (const c of cases) {
  const got = toParagraphHtml(c.md, c.opts);
  const okWant = c.want ? got.includes(c.want) : true;
  const okNot = (c.not || []).every((s) => !got.includes(s));
  if (!okWant || !okNot) {
    bad++;
    console.log("FAIL", c.name);
    console.log("  md  :", JSON.stringify(c.md));
    console.log("  got :", got);
    if (c.want) console.log("  want:", c.want);
    if (!okNot) console.log("  不该出现:", (c.not || []).filter((s) => got.includes(s)));
  } else {
    console.log("ok  ", c.name, "→", got.slice(0, 90));
  }
}
console.log(bad ? `\n${bad} 项失败` : "\n全部通过");
process.exit(bad ? 1 : 0);
