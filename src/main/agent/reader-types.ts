export type ReaderResult = {
  title: string;
  contentHtml: string;
  textContent: string;
  siteName?: string;
  url: string;
  degraded?: boolean;
};
