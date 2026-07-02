export {};

declare global {
  interface Window {
    pdf2midi: {
      platform: string;
      pickPdf: () => Promise<string | null>;
      apiBase: () => Promise<string>;
      pathForFile: (file: File) => string;
      exportDocument: (docId: string, baseName: string) => Promise<{
        ok: boolean; canceled?: boolean; dir?: string; files?: string[]; error?: string;
      }>;
    };
  }
}
